# 繩索受力分析系統 v2

依 **NFPA 1983 / UIAA 101 / OSHA 1926.502** 設計的互動式繩索力學計算工具，**PWA 可加到主畫面**離線使用。

## 模組總覽（共 9 個）

| 編號 | 模組 | 主要功能 |
|---|---|---|
| 1 | 繩索摩擦力 | Capstan 方程、螺旋繞線動畫、μ↔效率對照表（含 HowNot2 三部曲解讀） |
| 2 | 索道張力 | 兩端錨點＋負載皆可拖曳、向量平衡解、中央夾角、偏離拉力、**相機 AR / 全螢幕 / 截圖** |
| 3 | 墜落衝擊力 | UIAA Fall Factor、繩索拉伸動畫、人體承受門檻分級警告 |
| 4 | 死亡三角 | 水平擠壓力向量、HowNot2「迷思」實測解讀 |
| 5 | 變向固定點 | 重物垂吊圖示、變向錨點合力計算 |
| 6 | 拉力夾角模擬 | A/L 鎖定、僅拖曳 P、Capstan e^μθ 修正、緊邊切換 |
| 7 | 機械倍力 MA | 1:1 ~ 9:1 預設、滑輪效率級數損失、η↔μ 換算 |
| 8 | 高轉折點分析 | 三點拖曳（下方錨點/高轉折/操作端）、樹/鉤環/滑輪類型、**相機 AR / 全螢幕 / 截圖** |
| 9 | EN 認證規範 | 9 大器材類別、20 項標準（EN 892/1891/12275/362/12277/361/813/358/12492/397/565/566/354/355/360/567/12841/341/12278/795）、EN vs NFPA 對照 |

## 重要特色

### 力學分析
- **單位統一為 kgf**，符合救援/消防中文教材慣例
- **NFPA 1983 安全係數驗算**（G/T/E rated 切換 + 比例條）
- **人體承受門檻分級**：408/612/816/1224 kgf 五級警告（UIAA、OSHA、ANSI Z359）
- **不對稱解算**：索道張力支援兩錨點不同高、負載偏離中心的向量平衡解
- **Capstan 摩擦修正**：所有變向／轉折模組都採 e^(μθ) 真實計算

### 互動視覺化
- **相機 AR 疊圖**（模組 2、8）：直接用手機鏡頭對位現場，繩索受力線條疊在實景上
- **全螢幕模式**（模組 2、8）：放大畫布做 AR 對位，浮動工具列含相機、格線、截圖、退出
- **截圖儲存 PNG**：合成相機畫面 + SVG 圖層輸出，自動下載
- **格線與十字準星**：相機模式下青色半透明，方便量測
- **拖曳互動**：錨點、負載、拉力點皆可即時拖曳重新計算

### PWA 加到主畫面
- **manifest + service worker**：可離線使用、全螢幕 standalone 模式
- **頂部「📱 加到主畫面」按鈕**：Android Chrome 直接觸發系統安裝、iOS Safari 顯示步驟說明
- **網路優先（network-first）快取策略**：HTML 永遠抓最新版，靜態資源快取，更新即時生效
- **離線可用**：第一次載入後即使沒網路也能開啟

### EN 認證規範速查（模組 9）
9 大類別涵蓋繩索、鉤環、安全帶、頭盔、扁帶、連接繩、上升下降器、滑輪、錨點，每項標準附：
- 中英對照名稱、適用範圍、Sub-types 分類
- 測試要求表（強度、伸長率、墜落次數等）
- 實務備註（紅色警示「不可單用」「不可代替」）
- EN vs NFPA / ANSI 跨標準對照表

## 部署到 GitHub Pages

### 必上傳檔案（共 5 個，必須在同一層目錄）

```
index.html              主程式
manifest.webmanifest    PWA 設定
icon.svg                應用圖示
sw.js                   Service Worker（network-first 快取）
README.md               說明文件
```

### 部署指令

```bash
cd "C:\Users\FireFighter\Desktop\AI\繩索"
git init
git add index.html manifest.webmanifest icon.svg sw.js README.md
git commit -m "繩索受力分析系統 v2 + PWA"
git branch -M main
git remote add origin https://github.com/<YOUR_USERNAME>/<REPO_NAME>.git
git push -u origin main
```

到 GitHub repo → **Settings → Pages → Source 選 main / root → Save**

約 1 分鐘後可訪問 `https://<YOUR_USERNAME>.github.io/<REPO_NAME>/`

### 驗證部署成功

1. **頁面正常顯示** → index.html 上傳成功
2. **頂端有「📱 加到主畫面」按鈕** → React 跑起來了
3. **DevTools (F12) → Application → Manifest** 沒錯誤 → PWA 設定 OK
4. **Application → Service Workers** 顯示 sw.js 已 activated → 離線可用
5. **點「📱 加到主畫面」** → Android 跳對話框／iOS 跳教學

### 重要：相機 AR 需要 HTTPS
- GitHub Pages 自動提供 HTTPS ✓
- 本地測試要用 `localhost`（也算安全來源），不能用 `file://` 開啟

## 加到主畫面（手機）

### Android Chrome / Edge
頁面頂端點「📱 加到主畫面」→ 系統跳安裝對話框 → 一鍵裝好

### iPhone / iPad（必須用 Safari）
1. 點擊 Safari 底部的「分享」按鈕（⬆）
2. 向下滑找到「加入主畫面」（Add to Home Screen）
3. 點右上角「新增」（Add）

⚠ iOS 上 Chrome / Firefox 等其他瀏覽器無法加到主畫面（Apple 限制）

安裝後從主畫面點圖示，會用全螢幕 standalone 模式啟動，沒有網址列。

## 本地預覽

```bash
# Python
python -m http.server 8080
# 或 Node
npx serve .
```

打開 `http://localhost:8080`

## 技術架構

- **無 build 流程**：React 18 + Babel Standalone + Tailwind CDN，純 HTML 單檔即跑
- **無外部依賴**：圖示全部內嵌 SVG（不依賴 lucide-react）
- **PWA 規範**：W3C Web App Manifest + Service Worker
- **檔案大小**：~ 60 KB（不含 CDN）
- **相容性**：所有現代瀏覽器（Chrome / Firefox / Safari / Edge）+ iOS Safari + Android Chrome

## 物理公式參考

| 模組 | 公式 | 標準 |
|---|---|---|
| 1. Capstan | T₁ = T₂ × e^(μθ) · η = e^(−μθ) | 古典力學 |
| 2. Highline 對稱 | T = W / (2sinθ) | NFPA 救援 |
| 2. Highline 不對稱 | T_L·u_L + T_R·u_R + W = 0（向量平衡） | 線性代數 |
| 2. 偏離控制力 | F_h = −T·(u_L.x + u_R.x), T = −W/(u_L.y + u_R.y) | 等張力假設 |
| 3. Fall Impact | F = mg + √(mg² + 2k·mg·FF) | UIAA 101 |
| 4. Death Triangle | T = W·√(1+tan²(θ/2)) / (2cos(θ/2)) | 向量分解 |
| 5. Directional | F = 2T·cos(θ/2) | 向量合成 |
| 7. MA System | η_total = (1−η^n)/(1−η) · η ↔ μ：η = e^(−μπ) | 級數和 + Capstan |
| 8. 高轉折點 | R = T_A·û_A + T_O·û_O · T_緊 = T_鬆·e^(μθ) | 向量 + Capstan |

## μ ↔ 滑輪效率對照（180° 包覆角）

| μ 值 | 對應裝置 | 效率 |
|---|---|---|
| 0.03–0.05 | 球軸承滑輪（Petzl Rescue / SMC PMP） | 86–91% |
| 0.05–0.10 | 一般滑輪、軸套式滑輪 | 73–85% |
| 0.15–0.25 | 鉤環變向 | 46–62% |
| **0.30** | **粗糙鉤環 / 樹枝表面** | **39%** |
| 0.40–0.60 | 乾燥樹幹 / 粗糙岩石 | 28–15% |
| 0.60+ | 濕草、苔蘚 | ≤ 15% |

## 引用來源（外部影片解讀）

- [American Death Triangle is a Myth — HowNot2](https://www.youtube.com/watch?v=7sQNpjnJe40)（模組 4 解讀）
- [Coefficient of Friction Testing Part 1](https://www.youtube.com/watch?v=1r21sGpqd3w) / [Part 2](https://www.youtube.com/watch?v=l9wy479rKcw) / [Part 3](https://www.youtube.com/watch?v=kOf7zMUQPDc) — Over The Edge Rescue（模組 1 解讀）
- [Over The Edge Rescue 完整測試報告](https://overtheedgerescue.com/rope-rescue/oneortwocarabinersforfriction/)

## 故障排除

### GitHub Pages 顯示「pending」
- 第一次部署需 10–20 分鐘，先等等
- 確認 repo 是 Public（免費版必要）
- 加 `.nojekyll` 空檔跳過 Jekyll：`type nul > .nojekyll && git add .nojekyll && git commit -m "skip Jekyll" && git push`

### 部署成功但看到舊版
**Service Worker 快取問題**：
1. 用無痕模式驗證（看到新版就確認是 SW 快取）
2. 桌面：F12 → Application → Service Workers → Unregister + Clear site data + Ctrl+Shift+R
3. 手機 Chrome：⋮ → 設定 → 隱私權 → 清除瀏覽資料
4. 手機 Safari：設定 → Safari → 清除瀏覽記錄與資料

新版 sw.js 已改用 network-first，未來更新會自動生效，不再卡快取。

### 相機無法啟用
- 必須是 HTTPS 環境（GitHub Pages 自動提供）
- 本地測試用 `localhost`（不要用 `file://`）
- 第一次會跳出權限請求，要允許瀏覽器使用相機

## 免責聲明

本工具僅供教學與參考使用。實際繩索救援、攀岩或高空作業務必以**現場專業人員的判斷**為準，並依當地法規、製造商說明書與標準作業程序執行。作者對因使用本工具造成的任何損害不負責任。

模組 9 的 EN 認證資料整理自公開規範摘要，**採購器材時請以製造商提供的官方 CE 聲明書與最新版 EN 規範為準**。

## 授權

MIT License
