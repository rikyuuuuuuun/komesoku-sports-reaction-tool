# 海外反応スポーツ動画・半自動台本ジェネレーター（試作）

大谷翔平など海外で活躍する日本人選手について、**実在する取得済みコメントだけ**を候補化し、人間の編集判断用CSV・台本・スライド素材を作るPython試作です。動画・画像の取得、動画生成、投稿は行いません。

## 公開・利用範囲

これは**非商用の試作**です。Redditは入力で明示したスレッドURLだけを対象にし、1スレッドあたり最大300コメント（返信を含む）までを公式OAuth APIで取得します。全体検索、大量取得、非公式スクレイピングは行いません。

このプログラムは投稿、投票、メッセージ送信、アカウント操作を一切行いません。Reddit由来のコンテンツは `REVIEW_REQUIRED` として扱い、公開・商用利用の前に最新の規約・許諾・権利関係を人間が確認してください。

GitHubへ公開するのは `README.md`、`run.py`、`app/`、`tests/`、`input.example.json`、`.env.example`、`.gitignore` だけにしてください。`.env`、`input.json`、`output*/`、`cache/`、`fixtures/` は公開対象外です。

## 実装計画（この試作で実装済み）

1. `input.json` に選手、試合、YouTube/X/Reddit URLを入力する。
2. YouTube Data API v3 で指定動画のトップレベル英語コメントを取得する（コメント返信は取得しない）。
3. ローカル登録簿で重複を防ぎ、選手/プレー語との関連性、スパム・短文を判定する。
4. 感情・場面・海外らしさ・注意事項を機械的に仮分類し、原文を保ったまま翻訳候補と順位を作る。
5. 人間レビュー用CSV、公開前の台本案、スライド案、原典ログを `output/` に出力する。

翻訳・分類はルールベースの「下書き」です。曖昧さは `*_confidence` と `uncertainty_flags` に残るので、公開前に必ず人が原文・URL・日時を照合してください。fixtureは**明示的なテスト用の架空データ**であり、公開用に使ってはいけません。

## ディレクトリ構成

```text
.
├─ app/                 # 収集、分析、出力の実装
├─ fixtures/            # ローカル専用のテスト入力（GitHub公開しない）
├─ tests/               # 自動テスト
├─ output/              # 実行時生成（git管理しない）
├─ input.example.json   # 手動入力テンプレート（X/Reddit URLもここ）
├─ .env.example         # APIキーの変数名のみ
└─ run.py               # コマンドライン入口
```

## 必要APIと費用が出る場所

* **YouTube Data API v3**: `commentThreads.list` のみを利用。Google CloudでAPI有効化とキー発行が必要です。通常は日次クォータ内で始められますが、クォータ・課金条件はGoogle Cloudコンソールで必ず確認してください。コードはキーをログや出力に保存しません。
* **翻訳**: この試作は外部翻訳APIを使わず、限定的なルールベース下書きです。高品質化にOpenAI API/翻訳APIを接続する場合は、そのAPIの従量課金が発生し得ます（未実装）。
* **X / Reddit**: URLを記録する入力欄だけです。自動取得・スクレイピング・API呼び出しは未実装です。各プラットフォームの公式APIや規約を確認してから次段階で追加してください。

* **Reddit（指定スレッドのみ）**: 現在は公式OAuth Data APIで、`reddit_thread_urls` に明示したスレッドだけを最大300件（返信を含む）取得できます。`REDDIT_CLIENT_ID`、`REDDIT_CLIENT_SECRET`、`REDDIT_USER_AGENT` を `.env` に設定してください。Xは手動URL記録のみで、API・スクレイピングは実装していません。

## 初心者向け：APIキーなしで試す

Windows PowerShellで次を実行します。

```powershell
python -m unittest discover -s tests -v
# 自分で作成した合成fixtureがある場合のみ実行
python run.py --input input.example.json --fixture path/to/your_synthetic_fixture.json
```

ローカルで用意した合成fixtureを渡すと、`output/comments_raw.json`、`output/comments_review.csv`、`output/video_script.txt`、`output/slide_manifest.json`、`output/source_log.json` が作成されます。fixture由来の結果は `fixture_data: true` とし、公開に採用しないでください。GitHub公開版にはfixtureを含めません。

## 実在YouTubeコメントを取得する

1. Google Cloud Consoleで **YouTube Data API v3** を有効にし、APIキーを作成します。
2. `.env.example` を `.env` にコピーし、キーを設定します（`.env` はGitに追加しない）。
3. `input.example.json` を `input.json` にコピーし、試合情報とYouTube URLを入力します。
4. 実行します。

```powershell
Copy-Item .env.example .env
Copy-Item input.example.json input.json
python run.py --input input.json
```

URLが0件なら正常終了し、空のレビュー出力と入力URLのログだけを生成します。コメントが無効・非公開・APIクォータ超過の場合はログに失敗理由を記録します。

### 動画ごとの文脈を渡す（推奨）

`youtube_video_urls` は従来どおりURL文字列の配列でも使えますが、特定プレーの動画では次のオブジェクト形式を推奨します。選手名のない「What a bomb」のような反応も、対象動画の文脈を使って人間確認候補として残せます。

```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "subject": "Shohei Ohtani",
  "play": "three-run home run",
  "inning": "7th inning",
  "context": "Ohtani hit a three-run home run in this video"
}
```

### APIを使わずに再分析する

既存の `output/comments_raw.json` をそのまま再分類するには、次を実行します。APIへの通信・再取得は発生しません。

```powershell
python run.py --input input.json --reanalyze-raw
```

レビューCSVには、`relevance_level`（HIGH/MEDIUM/LOW）、`relevance_reason`、`video_context_used`、`short_reaction_preserved`、`strong_emotion_detected`、`candidate_tier`（A/B/C/REJECT）も出力されます。Aだけを自動推薦の対象にし、B/Cは必ず人が原文と対象場面を確認します。

## 編集フローと安全策

* `comments_review.csv` の `use_recommended` は自動提案にすぎません。採用・掲載は編集者が決めます。
* `author_anonymized` を台本・スライドで使い、表示名は使いません。生データには取得時の投稿者名も保持されますが、公開用ではありません。
* `warning` に皮肉・ジョーク・差別/中傷/性的表現の可能性が表示された候補は採用しないか、原典を確認してください。
* 独立したコメントを会話や返信のように連結しません。台本には各コメントの出典URLと独立コメントである旨を残します。
* Redditコメントは `commercial_use_status=REVIEW_REQUIRED` です。公開・収益化動画での利用前に、Redditの最新規約、投稿者の権利、必要な許諾を確認してください。自動推薦には使用しません。

## Redditを試す

API認証情報がない場合も、`reddit_manual_json_paths` または `reddit_manual_csv_paths` に人間が用意したファイルを指定できます。JSONはコメント配列、または `comments` 配列を持つオブジェクトです。`comment_id`、`original_text`、`thread_url`、`permalink`、`published_at` を残してください。

公式APIを使う場合は指定スレッドURLだけを取得し、OAuthトークンを保存しません。取得済みの結果は `cache/reddit/` に保存され、`--reanalyze-raw` はAPIを呼びません。

## 制限

場面（試合前/序盤/重要プレー直後/終了後）はコメントの投稿時刻と動画公開時刻、語句からの推定で、公式プレー時刻とは照合しません。対象プレー語を `target_play_terms` に入力し、必ず人が確認してください。トップレベルコメントだけのため、返信や削除済みコメントは対象外です。
