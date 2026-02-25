# ファインダー - 開発ガイド

## ビジョン
**「初心者が最初の日に出会いたかったファイルマネージャー」**

## コア思想
- 初心者がファイルをどっかやっちゃって困ってる → それを絶対に起こさせない
- 特にLinux/Ubuntuのファイルマネージャーがひどすぎる → これで置き換える
- とっつきが親切すぎるくらいに親切
- わかりやすければわかりやすいほどいい
- クラクラしないノリ、吐き気がしないUI
- 全部がハードルにならないこと。つまづかせない
- Look & Feel が優しい

## 技術スタック
- **デスクトップアプリ**: Electron（ブラウザのタブじゃない）
- **フロントエンド**: React + Vue（両方使う）
  - React: メインUI、ルーティング、状態管理
  - Vue: カテゴリカード等のウィジェット
- **データストア**: KVS（Key-Value Store）- pure JavaScript、ネイティブモジュール不要
- **バックエンドパターン**: ~/sfa の技術をフル活用
  - sfaのJSONBパターン → KVSのJSON永続化
  - sfaのSOQLクエリエンジン → 転置インデックス検索
  - sfaのExpressルーティング → Electron IPC
  - sfaのHelmetセキュリティ → contextIsolation
  - sfaのバッチ処理 → ファイル一括インデックス
  - sfaのSPA → React + Vue SPA
- **ビルド**: Vite + vite-plugin-electron
- **ファイル監視**: chokidar

## 必須機能
1. **検索ファースト** - 開いた瞬間に検索バーが主役
2. **カテゴリ自動分類** - 文書/画像/動画/音楽/コード/圧縮/フォント/データ/その他
3. **最近のファイル** - トップに常時表示
4. **よく使う場所** - ホーム/デスクトップ/ダウンロード/ドキュメント等
5. **ドラッグ＆ドロップ** - ファイルをドラッグして移動・コピー
6. **rsync自動同期** - フォルダ同期を簡単に（言わなくてもやってくれる）
7. **重複ファイル検出** - 同じファイルが複数ある場合を発見
8. **大きいファイル** - 容量食ってるファイルのランキング
9. **お気に入り** - よく使うファイルをブックマーク
10. **フォルダ閲覧** - パンくずリスト付きで迷わない

## 絶対守ること
- **完全フリー** - 金取らない、広告なし
- **軽量** - ネイティブモジュール不要、npm install だけで動く
- **Linux対応** - Ubuntu/Debian でもサクサク動く
- **日本語完全対応** - UI全部日本語
- **初心者目線** - 専門用語を使わない、大きなアイコン、わかりやすいラベル

## ディレクトリ構成
```
~/finder/
├── package.json          # 依存関係
├── vite.config.js        # Vite + React + Vue + Electron
├── index.html            # Vite エントリー
├── CLAUDE.md             # このファイル
├── electron/
│   ├── main.js           # Electronメインプロセス（IPC + ファイル操作 + rsync）
│   └── preload.js        # コンテキストブリッジ（セキュアIPC）
├── lib/
│   ├── kvs.js            # Pure JS Key-Value Store（JSONB的永続化）
│   └── indexer.js         # ファイルインデクサー + リアルタイム監視
├── src/
│   ├── main.jsx          # React エントリー
│   ├── App.jsx           # メインReactアプリ（全ビュー）
│   ├── App.css           # デザインシステム
│   └── vue/
│       └── CategoryCards.vue  # Vueカテゴリウィジェット
├── server.js             # (レガシー) ブラウザ版サーバー
└── public/
    └── index.html        # (レガシー) ブラウザ版UI
```

## 起動方法
```bash
cd ~/finder
npm install
npm run dev
```

## Linuxでの起動
```bash
# Node.js 18+
sudo apt install nodejs npm
cd ~/finder
npm install
npm run dev
```
