# nextword-local-dictionary

从 NextWord 项目中提取的可移植离线英汉词典包。运行时不需要数据库、网络、DeepSeek 或其他 npm 依赖。

## 环境要求

- Node.js 20 或更高版本
- 仅支持服务端 Node.js，不应直接打包进浏览器前端

## 安装

使用生成的 npm 压缩包：

```bash
npm install ./nextword-local-dictionary-1.0.0.tgz
```

也可以把解压后的整个目录复制到目标项目，再使用文件依赖：

```json
{
  "dependencies": {
    "nextword-local-dictionary": "file:./vendor/nextword-local-dictionary"
  }
}
```

然后运行：

```bash
npm install
```

## 基本查询

```js
import { lookup } from "nextword-local-dictionary";

const entry = await lookup("running");
console.log(entry?.lemma);           // run
console.log(entry?.phonetic);        // /rʌn/
console.log(entry?.cefrLevel);       // A1
console.log(entry?.basicMeaningsZh);
```

## 独立实例

当词典数据放在自定义目录时：

```js
import { createDictionary } from "nextword-local-dictionary";

const dictionary = createDictionary({
  dataDir: "D:/dictionary-data"
});

console.log(dictionary.getHealth());
const entry = await dictionary.lookup("studies");
```

## API

### `lookup(word)`

查询单词并进行基础词形还原，例如 `running → run`、`studies → study`。没有结果时返回 `null`。

### `lookupExact(word)`

只查询输入的精确词条，不进行词形还原。

### `lookupMany(words)`

批量查询多个单词，返回顺序与输入一致。

### `getHealth()`

检查 `data/dictionary.pack` 数据包是否存在、格式有效，以及可选增强区段（双语定义、CEFR、词族）是否完整。

### `clearCaches()`

清除当前实例已加载的索引分片和增强数据缓存。

## 数据组成

运行时数据全部打包在单个 `data/dictionary.pack` 容器文件中，内部为「目录头 + 数据区」结构：

- ECDICT 词条记录区（原始 CSV 数据行，随机按偏移读取）
- 按首字符拆分的词索引区段
- 中英双语定义增强区段（人工英文定义与中文翻译已按词合并去重）
- CEFR A1–C2 等级区段
- 词族及相关词区段
- 少量人工优化词条（覆盖层）

查询时只读取目录头和目标词所在的分片与记录，无需全量加载。完整文件校验值位于包内 `DATA_MANIFEST.json`。

## 从源数据重建

`sources/` 目录（不随 npm 包发布）保存生成原料：

- `ecdict.csv` — ECDICT 源数据
- `ecdict-definition-zh.jsonl` — 中文双语定义原料
- `ecdict-definition-en-manual.jsonl` — 人工英文定义原料
- `ecdict-word-levels.jsonl` — CEFR 等级原料
- `word-families.jsonl` — 词族原料
- `overrides.jsonl` — 人工优化覆盖词条

更新任一原料后重新生成数据包与校验清单：

```bash
npm run build:data
```

也可以分步执行 `npm run build:pack` 和 `npm run build:manifest`。

## 许可

ECDICT 数据的 MIT 许可保存在 `LICENSE-ECDICT`，来源说明见 `THIRD_PARTY_NOTICES.md`。本包的项目代码当前标记为 `UNLICENSED`，如需对外发布，请由项目所有者另行指定代码许可证。
