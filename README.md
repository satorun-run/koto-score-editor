# 箏譜エディタ

横書きの箏譜（絃名譜）を入力・編集し、Illustrator などのDTPアプリ向けにSVGで書き出すWebアプリです。

- 公開版：https://satorun-run.github.io/koto-score-editor/
- 仕様：[SPEC.md](SPEC.md)
- 下書き記法：[drafts/README.md](drafts/README.md)

## 使い方

### 公開版（iPad など）

ブラウザで公開版のURLを開きます。楽譜は「開く」で `.koto.json` ファイルを選びます。
編集内容はそのブラウザの中に自動保存されます。別の端末へ渡すときは「保存」でファイルにします。

絃の入力はテンキーを使うので、キーボードが必要です。

### このPCで動かす

`start.bat` をダブルクリックします。ブラウザで `http://localhost:5183/` が開きます。

## 公開版に含めていないもの

出版物のスキャン画像と、そこから起こしたデータ（元譜の字形、全曲の下書き）は、このリポジトリに含めていません。

- 公開版では、絃名は端末のフォントで表示します。
- 元譜の字形で表示したい楽譜は、このPCで「保存」したファイルを使います。保存したファイルには、表示に使っている字形が入ります。

## 開発

```
npm install
npm run dev        # 開発用サーバー
npm test           # テスト
npm run build      # ビルド
```

`main` ブランチに push すると、GitHub Actions がビルドして GitHub Pages に公開します。
