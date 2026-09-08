// /masters は入口を持たない。現場一覧へ送る。
// 🔴 タブの先頭と一致させる。ここだけ別の画面にすると
//    「戻る」で戻ったときに位置が変わって迷う。
import { redirect } from "next/navigation";

export default function MastersIndex() {
  redirect("/masters/sites");
}
