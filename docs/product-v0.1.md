# 0.1 実装メモ

## 構成

Windows bat / npm start → Node HTTPサーバー → SQLite。フロントエンドは静的HTML/CSS/JS、2秒ごとの取得。実行時の追加npm依存、ビルド、常駐サービス登録は不要。

ブラウザでタスクを登録し、起動コマンドをコピーする。サーバーはCLIの起動や任意コマンドの実行をしない。作業ディレクトリはCLI側で検証する。

CLI側は `connect` で接続情報を保存する。ラッパーがCLI別hook定義と起動IDをプロセスに渡す。hookは許可フィールドのみローカルSQLiteへ記録し、outboxに追加する。`report` は明示的な意味情報を保存する。hook・ラッパーの定期処理・手動 `sync` が認証付きAPIへ送信する。送信タイムアウトは1.5秒、hook設定は5秒。通信失敗はCLI作業を止めない。

outbox操作にはUUIDがあり、サーバーのreceiptとイベントID、報告revisionで重複を防ぐ。同一クライアント内はoutbox順に送信する。報告は最大revisionを採用する。異なるクライアントの時計を実稼働時間とみなさず、受信日時を使用する。

## hook / skill / pluginの判断

初版に必要なのは起動ラッパーとhook・報告コマンド。ユーザーが別途skillやpluginを導入する方式にはしない。報告手順はSessionStart / UserPromptSubmit / SubagentStartの追加コンテキストで渡す。hook定義に起動IDを埋め込まず、環境変数で渡すことでタスクごとの再信頼を減らす。

非管理hookはCodexで信頼確認が必要で、追加コンテキストを返せるイベントがある。確認をバイパスしない。[OpenAI公式hook仕様](https://developers.openai.com/ja-JP/docs/hooks)

Claude Codeのイベント別入力・出力仕様に合わせたhookを渡す。Agent Teamsのイベント取得は全体の完了判定と分離し、追加コンテキストを受けた各担当は担当分のみ報告する。[Claude Code公式hook仕様](https://code.claude.com/docs/en/hooks)

## セキュリティ境界

既定はループバックのみ。LAN待ち受けは明示指定。起動時にランダムなアクセスキーをローカル生成。ブラウザはキーによるログイン後にHttpOnly / SameSite=Strictの24時間Cookie、CLIはBearer認証を使う。サーバー再起動でブラウザセッションは失効する。HostとOriginを検証し、JSONのみ受理する。ログイン失敗にはIPごとの短いレート制限がある。

HTTP通信は暗号化されず、共有キーによる個人向け認証である。インターネット公開・多ユーザー運用向けの認証やTLS・権限分離は範囲外。秘密はURLやコピー用起動コマンドには含めない。設定ファイルはGit対象外とし、POSIXではユーザーのみ読み書きできるモードで作成する。WindowsではユーザーフォルダーのACLに依存する。

## 検証の区別

Nodeテストは両プロバイダーの疑似hook、役割分離、報告検証、再送・重複・切断復旧、実HTTP認証、旧DBとの共存を確認する。ブラウザテストは登録・コマンド表示・デモ分離・図の選択・時系列・モバイル・切断表示を確認する。モデルは呼ばない。

試作時にCodexのLinux実CLI報告は確認済み。新しい安定hook方式の実モデル経由の報告、Claudeログイン後の実チーム、Windowsの実CLIは別の検証対象であり、疑似hook試験から動作保証をしない。Windows/Linux × Node 22/24のCIを用意する。

## 見送ったもの

クラウド常駐、ブラウザからのCLI操作、ユーザー権限分離、タスク編集・削除・切替、再開セッションの完全な継続、GitHub外部同期、正確な実行時間・費用計算、heartbeatなしのプロセス生存断定。要求と実装の差分はREADMEの制約で明示する。
