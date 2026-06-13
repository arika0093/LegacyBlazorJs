# LegacyBlazorJs

ASP.NET Core 公式リポジトリの各リリースタグから `blazor.web.js` を公式の Web.JS production script でビルドし、複数のブラウザー対象へ再トランスパイルして、**Razor Class Library の NuGet パッケージ**として公開するためのプロジェクトです。

## 動作の流れ

1. `config/majors.json` に列挙した .NET 8、9、10 などの各メジャーバージョンについて、`dotnet/aspnetcore` の最新安定タグを GitHub API から解決します。
2. 該当タグを clone し、`src/Components/Web.JS` の upstream `build:production` script で公式 `blazor.web.js` を生成します。
3. upstream の TypeScript と webpack/Terser の対象設定を差し替えて対象別 JavaScript を生成し、Razor Class Library の `wwwroot` に配置します。
4. 元タグの `v` を除いたバージョン（例: `v8.0.27` → `8.0.27`）で `LegacyBlazorJs` NuGet パッケージを作成します。

## 収録ファイルと対象ブラウザー

NuGet パッケージを参照したアプリでは、各ファイルを `_content/LegacyBlazorJs/<ファイル名>` から配信できます。

| ファイル | 想定対象ブラウザー | TypeScript/webpack 出力構文 |
|---|---|---|
| `blazor.web.ie6.js` | Internet Explorer 6 以降（best effort） | ES5 |
| `blazor.web.ie7.js` | Internet Explorer 7 以降（best effort） | ES5 |
| `blazor.web.ie8.js` | Internet Explorer 8 以降（best effort） | ES5 |
| `blazor.web.ie9.js` | Internet Explorer 9 以降（best effort） | ES5 |
| `blazor.web.ie10.js` | Internet Explorer 10 以降（best effort） | ES5 |
| `blazor.web.ie11.js` | Internet Explorer 11 以降（best effort） | ES5 |
| `blazor.web.es2015.js` | Chrome 49+, Edge 14+, Firefox 45+, Safari 10+ | ES2015 |
| `blazor.web.es2016.js` | Chrome 52+, Edge 14+, Firefox 52+, Safari 10.1+ | ES2016 |
| `blazor.web.es2017.js` | Chrome 58+, Edge 16+, Firefox 54+, Safari 11+ | ES2017 |
| `blazor.web.es2018.js` | Chrome 64+, Edge 79+, Firefox 58+, Safari 12+ | ES2018 |
| `blazor.web.es2019.js` | Chrome 73+, Edge 79+, Firefox 67+, Safari 12.1+ | ES2019 |
| `blazor.web.es2020.js` | Chrome 80+, Edge 80+, Firefox 74+, Safari 13.1+ | ES2020 |
| `blazor.web.es2021.js` | Chrome 85+, Edge 85+, Firefox 79+, Safari 14.1+ | ES2021 |
| `blazor.web.es2022.js` | Chrome 94+, Edge 94+, Firefox 93+, Safari 15.4+ | ES2022 |

対象の定義元は `config/targets.json` です。要望に合わせて `modern` は収録していません。

> [!WARNING]
> IE 向けファイルは JavaScript **構文**を可能な限り変換する best-effort ビルドです。構文のダウンレベルビルドは DOM API、WebAssembly、Promise、Fetch、URL、WebSocket などを実装しません。現在の Blazor ランタイムが要求する機能を IE が満たす保証もないため、IE 上での起動を保証するものではありません。必要な polyfill と実ブラウザーでの検証は利用側で行ってください。

## 必要環境とローカルビルド

- Git
- Node.js 20 以降と Corepack/Yarn
- .NET 8 SDK 以降
- upstream と npm/NuGet の依存物を取得できるインターネット接続

```bash
npm install
npm run build -- 8
```

上記は .NET 8 の最新安定タグを取得・ビルドし、`artifacts/packages/LegacyBlazorJs.<version>.nupkg` を生成します。特定タグを再現する場合は次のように指定します。

```bash
ASPNETCORE_TAG=v8.0.27 npm run build
```

## Blazor アプリでの利用

```bash
dotnet add package LegacyBlazorJs --version 8.0.27
```

Blazor Web App の `Components/App.razor` にある公式 script を、必要な対象へ差し替えます。

```html
<!-- <script src="_framework/blazor.web.js"></script> -->
<script src="_content/LegacyBlazorJs/blazor.web.es2015.js"></script>
```

パッケージは static web assets を持つ Razor Class Library なので、アプリ側へ JavaScript をコピーする必要はありません。

## 動作確認

`smoke-test.yml` は生成された NuGet パッケージをテンプレートの Blazor Server アプリへ追加し、各 JavaScript ファイルを1つずつ読み込みます。Playwright Chromium で Counter ページを開き、ボタン操作後にカウントが更新されることと、ブラウザーエラーがないことを確認します。これは各ファイルが現行 Chromium で動作する確認であり、IE 実機の互換性確認ではありません。upstream のビルド済み bundle を後処理で再トランスパイルすると Blazor Server の起動が壊れるため、各プロファイルは upstream ソースから再ビルドします。

ローカルでも、パッケージ生成後に対象を指定して実行できます。

```bash
npx playwright install --with-deps chromium
npm run test:smoke -- es2015 8.0.27
```

## 自動公開

`.github/workflows/publish-latest.yml` は毎週、各対象メジャーバージョンの最新安定タグをビルドし、`dotnet nuget push --skip-duplicate` で NuGet.org へ公開します。リポジトリ Secret `NUGET_API_KEY` を設定してください。初回は workflow dispatch の `publish=false` で成果物を確認してから公開することを推奨します。

## ライセンス

このリポジトリの自動化コードは MIT License です。生成 JavaScript は Microsoft の `dotnet/aspnetcore` に由来します。公開前に upstream のライセンス、商標、再配布条件を確認してください。パッケージには `THIRD-PARTY-NOTICES.txt` と、正確な upstream タグを示す `build-manifest.json` を収録します。
