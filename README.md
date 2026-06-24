# Discord Cloud File Bot

Discordの `/upload` から一時URLを発行し、Discord OAuth2で本人確認したうえでGoogle Driveへ直接アップロードするMVPです。

## セットアップ

```bash
npm install
cp .env.example .env.local
```

`.env.local` にDiscord、Supabase、Google OAuthの値を設定します。

Supabase SQL Editorで `supabase/migrations/0001_initial.sql` を実行します。

## 開発

```bash
npm run dev
```

Discord Interaction Endpointのローカル検証にはngrokやCloudflare Tunnelなどの公開URLが必要です。

```text
https://your-public-url.example/api/discord/interactions
```

## Discordコマンド登録

開発中は `.env.local` に `DISCORD_GUILD_ID` を設定するとGuild Commandとして即時反映されます。

```bash
npm run register:commands
```

## MVPの範囲

- `/upload`
- 一時アップロードURL
- Discord OAuth2ログイン
- アップロードする本人のGoogle Drive連携
- Google Drive再開可能アップロード
- Supabaseメタデータ保存
- Discord完了通知
- ファイル詳細表示
- 投稿者削除

## Google Drive連携

ファイルは運営者のDriveではなく、アップロードする本人のGoogle Driveへ保存します。

Google Cloud ConsoleでOAuth Clientを作成し、Redirect URIに現在の `APP_URL` を使ったCallbackを登録します。

```text
https://your-ngrok-domain.example/api/google/callback
```

開発中の例:

```text
https://parole-amount-snub.ngrok-free.dev/api/google/callback
```

必要な環境変数:

```dotenv
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
APP_ENCRYPTION_KEY=
```

Supabase SQL Editorで `supabase/migrations/0002_google_accounts.sql` も実行してください。

Google Driveへのブラウザ直接PUTが成立しない場合は、早期にCloudflare R2またはGoogle Cloud Storageへ切り替える前提です。

## YouTube埋め込みを試す

動画をYouTubeへ限定公開アップロードし、Discord本文にYouTube URLを表示できます。

```dotenv
YOUTUBE_UPLOAD_VIDEOS=true
NEXT_PUBLIC_YOUTUBE_UPLOAD_VIDEOS=true
```

Google Cloud Consoleで YouTube Data API v3 を有効化し、Google連携をやり直してください。

## Vercelへデプロイ

VercelのEnvironment Variablesへ `.env.local` と同じ値を設定します。

本番URLが `https://your-app.vercel.app` の場合、最低限このURLに揃えます。

```dotenv
APP_URL=https://your-app.vercel.app
AUTH_URL=https://your-app.vercel.app
NEXTAUTH_URL=https://your-app.vercel.app
```

外部サービス側にも同じURLを登録します。

```text
Discord Interactions Endpoint:
https://your-app.vercel.app/api/discord/interactions

Discord OAuth Redirect:
https://your-app.vercel.app/api/auth/callback/discord

Google OAuth Redirect:
https://your-app.vercel.app/api/google/callback
```

YouTubeアップロードを使う場合は、動画本体をサーバー経由でDrive/YouTubeへ送るため、大きな動画ではVercelの関数制限に当たる可能性があります。安定運用ではCloudflare R2やCloud Runなど、長時間・大容量アップロード向けの処理基盤へ切り出してください。
# DisDrive
