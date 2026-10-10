import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // GitHub Pages では https://<ユーザー名>.github.io/<リポジトリ名>/ の下に置かれるので、相対パスで参照する
  base: "./",
  // ブラウザ内の保存（自動保存・既定の設定・キー割り当て）は接続先ごとに分かれる。
  // 空いている番号へ勝手に移ると保存した内容が見えなくなるので、番号を固定する
  server: { port: 5183, strictPort: true },
});
