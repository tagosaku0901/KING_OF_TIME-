# KingOfTime Quick Input

KING OF TIME の月次一覧画面から直接勤怠（出勤・退勤時刻）を入力し、一括登録できるChrome拡張機能です。

## インストール方法

1. Chromeで `chrome://extensions/` を開く
2. 右上の「デベロッパーモード」をONにする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. このフォルダを選択

## 使い方

1. KING OF TIMEにログインし、月次一覧画面を開く
2. 各日付の出勤・退勤セルが入力フィールドに変わる
3. 時刻を `HH:MM` 形式で入力（数字を打てば自動的に `:` が入る）
4. Enterキーで次のフィールドに移動
5. 右下の「一括登録」ボタンをクリックで全日分を送信

## 初期設定（重要）

この拡張機能を動作させるには、実際のKING OF TIMEのDOM構造とAPIに合わせた調整が必要です。

### 確認手順

1. KING OF TIMEの月次一覧画面を開く
2. F12（DevTools）を開く
3. 以下を確認して `content.js` の `CONFIG` を修正:

| 設定項目 | 確認方法 |
|---------|---------|
| `tableSelector` | Elementsタブで一覧テーブルのセレクタを確認 |
| `dateCellIndex` | テーブル行内で日付が何番目のセルか |
| `startTimeCellIndex` | 出勤時刻が何番目のセルか |
| `endTimeCellIndex` | 退勤時刻が何番目のセルか |
| `apiEndpoint` | Networkタブで勤怠保存時のリクエストURLを確認 |
| `csrfTokenSelector` | CSRFトークンの取得方法を確認 |

### API調査方法

1. 通常の操作で1日分の勤怠を手動登録する
2. DevToolsのNetworkタブでリクエストを確認
3. URL、メソッド、リクエストボディの形式をメモ
4. `submitAttendance()` 関数を修正

## ファイル構成

```
├── manifest.json   ... Chrome拡張の設定ファイル
├── content.js      ... メインロジック（DOM操作・API送信）
├── styles.css      ... UIスタイル
└── README.md       ... このファイル
```

## 今後の拡張予定

- [ ] 休憩時間の入力対応
- [ ] 備考欄の入力対応
- [ ] テンプレート機能（定時勤務を一括入力）
- [ ] 入力履歴の保存・復元
