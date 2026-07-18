import argparse
import os
import sys
from app.config import load_dotenv, load_input, youtube_sources
from app.pipeline import write_outputs
from app.youtube import fetch_comments, load_fixture
from app.reddit import fetch_thread, load_manual


def main() -> int:
    parser = argparse.ArgumentParser(description="Sourced sports-reaction comment review prototype")
    parser.add_argument("--input", required=True, help="JSON with game details and URLs")
    parser.add_argument("--fixture", help="TEST-ONLY fixture JSON; never use results publicly")
    parser.add_argument("--reanalyze-raw", action="store_true", help="Reanalyze output/comments_raw.json without any API request")
    parser.add_argument("--output", default="output")
    args = parser.parse_args()
    config = load_input(args.input); load_dotenv()
    comments, logs = [], []
    if args.reanalyze_raw:
        import json
        from pathlib import Path
        raw_path = Path(args.output) / "comments_raw.json"
        if not raw_path.exists():
            print(f"Missing raw comment cache: {raw_path}", file=sys.stderr); return 2
        comments = json.loads(raw_path.read_text(encoding="utf-8"))
        logs = [{"source": "local_cache", "status": "reanalyze_only", "source_path": str(raw_path), "fetched_count": 0}]
    elif args.fixture:
        comments, logs = load_fixture(args.fixture)
    else:
        key = os.getenv("YOUTUBE_API_KEY")
        sources = youtube_sources(config)
        urls = [source["url"] for source in sources]
        if urls and not key:
            logs.append({"source": "youtube", "status": "error", "error_type": "MissingCredential", "error": "YouTube API request was skipped because YOUTUBE_API_KEY is not configured."})
        else:
            for url in urls:
                try:
                    found, log = fetch_comments(url, key); comments.extend(found); logs.append(log)
                except Exception as exc:
                    # Do not serialize exception strings: HTTP errors can embed request URLs containing the API key.
                    logs.append({"source": "youtube", "source_url": url, "status": "error", "error_type": type(exc).__name__, "error": "YouTube API request failed; inspect API configuration and quota outside this log."})
        reddit_limit = int(config.get("reddit_fetch", {}).get("max_comments_per_thread", 300))
        reddit_limit = max(1, min(reddit_limit, 300))
        for thread_url in config.get("reddit_thread_urls", []):
            try:
                found, log = fetch_thread(thread_url, reddit_limit); comments.extend(found); logs.append(log)
            except Exception as exc:
                logs.append({"source": "reddit", "source_url": thread_url, "status": "error", "error_type": type(exc).__name__, "error": "Reddit API request was not completed; configure official OAuth credentials or use manual input."})
        for path in [*config.get("reddit_manual_json_paths", []), *config.get("reddit_manual_csv_paths", [])]:
            try:
                found, log = load_manual(path); comments.extend(found); logs.append(log)
            except Exception as exc:
                logs.append({"source": "reddit", "status": "manual_input_error", "error_type": type(exc).__name__, "error": "Reddit manual input could not be read."})
    selected, summary = write_outputs(comments, logs, config, args.output)
    print(f"Wrote review artifacts to {args.output}; fetched/registered={summary['registered_comment_count']}, candidates={len(selected)}, excluded={summary['excluded_count']}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
