# ECS 控制台 · 桌面版（办法一 + 办法二）

跑在**你自己电脑上**的本地软件，直接控制 阿里云 ECS + Cloudflare + 飞书 + RCON/MC + 云助手。
**不用任何 serverless、不用实名、不用付费、不存在"学校打不开"。** 原始 TCP（RCON/MC/探活）在本机也能全跑。

## 一、两种连接办法（都做进来了）
- **办法一 · 直连（默认）**：软件**直接**连 阿里云 / Cloudflare / 飞书 / RCON / 云助手。凭据全在本地 `config.json`。
- **办法二 · 走函数（中继）**：软件**只连 阿里云**，把"需要稳定外网"的活儿（Cloudflare 改 A 记录、飞书推送）委托给**阿里云 函数计算 FC**（它外网稳，学校也能推）。界面上切"走函数"，并**启用/停用**这个中继。

## 二、在你电脑上跑（Windows）
1. 装 **Node.js**（装 18/20 都行，nodejs.org 下载 LTS）。
2. 把本目录放电脑上，开命令行：
   ```
   npm install
   npm start            ← 弹出桌面窗口（Electron），并自动开本地服务
   ```
   - 想更轻、不用装 Electron：`npm run server`（起本地服务，浏览器打开 `http://127.0.0.1:8790`）。
   - 想打 **.exe** 单文件：`npm run build:win`（产物在 `dist/`）。
3. **填配置**：`config.json` 已经帮你预填好（AK/SK、实例、CF、飞书、RCON、MCS 端口等）。缺的/要改的直接改它。
   - 办法二再填：`RELAY_URL`（阿里云 FC 触发器地址）+ `RELAY_SECRET`，并把 `MODE` 改成 `function`（或界面点"走函数"）。

## 三、"走函数"的中继函数（阿里云 FC）
就是**你那套 FC 版 `ecs-console.zip`**（同一份代码，传上 阿里云 FC）：
1. 把 `ecs-console.zip` 传到 阿里云 FC（cn-hongkong / 或离学校近的地域），处理程序 `index.handler`，超时 300s。
2. 建一个 **HTTP 触发器**（无需认证 / 或配个密钥），把它给的 **触发器 URL** 填进桌面版 `config.json` 的 `RELAY_URL`；`RELAY_SECRET` 填一个你自己起的串（两边一致）。
3. 桌面版切到"走函数"后，CF/飞书 就通过 FC 执行（FC 外网稳 → 学校也能用）；"启用/停用中继"= 云端开关（停用后不再花调用费）。
   - 说明：FC 没免费额度会有**少量**调用费（你这点用量≈几毛/月）。这是你选的"阿里云 FC 中继"。

## 四、MCS manager 端口（23333）
- 已加进**探活**：点"探活"会同时探 `公网IP:MC口` 和 `公网IP:23333`，并在状态卡显示"MCS manager 23333：可达/不可达"。
- 端口可在 `config.json` 改 `MCS_MANAGER_PORT`（默认 23333）。

## 五、Cloudflare 在学校连不上？
自动**跳过 + 提示**，不影响开机/探活/飞书。你在学校直接用 **ECS 公网 IP** 连 MC 即可，回家/网络好时 CF 域名再更新。

## 六、前置条件
- **云助手 Agent**：ECS 装 `aliyun assist`（公共镜像默认有）→ OS 命令/审计才跑得了。
- **RCON**：`server.properties` 开 `enable-rcon=true`、`rcon.port=25575`、`rcon.password=…`，**安全组放行 25575（只给你家/学校 IP）**。
- **MCS 23333**：确认那个管理器端口已开，**安全组放行 23333**。
- **飞书**：应用已拉进群（chat_id 已在 config.json）。

## 七、手机版
桌面版跑通后另做（原生 App 直连 阿里云/CF/飞书，需 App 开发管线）。先搞定桌面版。
