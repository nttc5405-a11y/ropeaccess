# 繩索受力分析系統 v2

依 **NFPA 1983 / UIAA 101 / OSHA 1926.502** 設計的互動式繩索力學計算工具。

## 主要修正（相對 v1）

1. **單位統一** — 全面改為 kN（主）+ kgf（副）並列，符合救援/攀登國際慣例
2. **NFPA 1983 安全係數驗算** — 每個模組加入 G/T/E rated 切換、自動 SF 評估與比例條
3. **人體承受門檻分級** — 4/6/8/12 kN 五級警告（UIAA、OSHA、ANSI Z359）
4. **動畫升級**
   - 模組 1：螺旋繞線真實繪製 Capstan 路徑
   - 模組 3：繩索拉伸 + 衝擊瞬間紅色脈衝特效
   - 模組 4：死亡三角的水平擠壓力箭頭
   - 全域：count-up 數字動畫、無障礙焦點環
5. **新增模組 7：機械倍力系統 (MA System)** — 含 Z-rig / Compound 預設、滑輪效率損失計算
6. **Bug 修正**
   - `useEffect` 依賴陣列問題（會造成無限迴圈）
   - 死亡三角力學公式重新推導
   - SVG 動畫改用更穩定的寫法
7. **無障礙 (a11y)** — `aria-label`、`aria-valuetext`、鍵盤焦點環、`role="tab"`
8. **列印 / PDF 匯出** — 標題列「列印 / PDF」按鈕，CSS print media 已優化

## 部署到 GitHub Pages

### 方法 A：直接從倉庫部署（最簡單）

```bash
# 在這個資料夾裡執行
git init
git add index.html README.md
git commit -m "Initial commit: 繩索受力分析系統 v2"
git branch -M main
git remote add origin https://github.com/<YOUR_USERNAME>/<REPO_NAME>.git
git push -u origin main
```

然後到 GitHub 倉庫頁：

1. **Settings** → **Pages**
2. **Source** 選 `Deploy from a branch`
3. **Branch** 選 `main` / `/ (root)` → **Save**
4. 約 1 分鐘後即可訪問 `https://<YOUR_USERNAME>.github.io/<REPO_NAME>/`

### 方法 B：使用 `gh-pages` 分支

如果你之後會加入 build 步驟（例如未來改用 Vite），先用 root 部署即可。

## 本地預覽

不需要 build，直接：

```bash
# Python
python -m http.server 8080
# 或 Node
npx serve .
```

打開 `http://localhost:8080` 即可。

## 技術架構

- **無 build**：React 18 + Babel Standalone + Tailwind CDN，純 HTML 單檔即跑
- **無外部依賴**：圖示全部內嵌 SVG（不依賴 lucide）
- **檔案大小**：< 30 KB（壓縮前）
- **相容性**：所有現代瀏覽器（Chrome / Firefox / Safari / Edge）

## 公式參考

| 模組 | 公式 | 標準 |
|---|---|---|
| Capstan | T₁ = T₂ × e^(μθ) | 古典力學 |
| Highline | T = W / (2sinθ) | NFPA 救援 |
| Fall Impact | F = mg + √(mg² + 2k·mg·FF) | UIAA 101 |
| Death Triangle | T = W·√(1+tan²(θ/2)) / (2cos(θ/2)) | 向量分解 |
| Directional | F = 2T·cos(θ/2) | 向量合成 |
| MA System | η_total = (1−η^n)/(1−η) | 級數和近似 |

## 免責聲明

本工具僅供教學與參考使用。實際繩索救援、攀岩或高空作業務必以**現場專業人員的判斷**為準，並依當地法規與標準作業程序執行。作者對因使用本工具造成的任何損害不負責任。

## 授權

MIT License
