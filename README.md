# 🔖 私人书签管理

基于 Cloudflare Pages + Functions + D1 的书签管理系统。

## 功能

- 🔐 密码认证
- ➕ 添加 / 编辑 / 删除书签
- 📁 分类管理
- 🏷️ 多标签系统
- 🔍 实时搜索（标题 / URL / 描述 / 标签）
- 📤 导出 / 📥 导入 JSON
- 📱 响应式设计
- 🌐 自动抓取网站 favicon

## 架构

```
CF Pages（前端）
  + CF Pages Functions（API /api/*）
    + CF D1（SQLite 数据库）
```

## 部署

```bash
# 1. 创建 D1 数据库
wrangler d1 create bookmarks

# 2. 更新 wrangler.toml 中的 database_id

# 3. 建表
wrangler d1 execute bookmarks --remote --command "
CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT '未分类',
  tags TEXT DEFAULT '',
  favicon TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);"

# 4. 创建 Pages 项目
wrangler pages project create bookmarks --production-branch main

# 5. 部署
wrangler pages deploy dist --project-name bookmarks
```

## 配置

编辑 `wrangler.toml` 中的 `ACCESS_PASSWORD` 修改访问密码。

## 技术栈

- Cloudflare Pages + Functions
- Cloudflare D1 (SQLite)
- 纯 HTML/CSS/JS（无框架依赖）
