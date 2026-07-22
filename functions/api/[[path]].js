// 书签管理 API — CF Pages Functions
// 路由: /api/*

const ACCESS_PASSWORD = env => env.ACCESS_PASSWORD || "zwdq2026";

// ── 工具函数 ──
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

function checkAuth(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace("Bearer ", "");
  return token === ACCESS_PASSWORD(env);
}

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function getFavicon(url) {
  const domain = getDomain(url);
  if (!domain) return "";
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

// ── 路由处理 ──
async function handleList(request, env) {
  const url = new URL(request.url);
  const params = url.searchParams;

  let sql = "SELECT * FROM bookmarks";
  const conditions = [];
  const binds = [];

  const search = params.get("q");
  if (search) {
    conditions.push("(title LIKE ? OR url LIKE ? OR description LIKE ? OR tags LIKE ?)");
    const kw = `%${search}%`;
    binds.push(kw, kw, kw, kw);
  }

  const category = params.get("category");
  if (category && category !== "全部") {
    conditions.push("category = ?");
    binds.push(category);
  }

  const tag = params.get("tag");
  if (tag) {
    conditions.push("tags LIKE ?");
    binds.push(`%${tag}%`);
  }

  if (conditions.length) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  sql += " ORDER BY created_at DESC";

  const stmt = env.DB.prepare(sql).bind(...binds);
  const result = await stmt.all();
  return json({ success: true, data: result.results });
}

async function handleCreate(request, env) {
  const body = await request.json();
  if (!body.url || !body.title) {
    return json({ success: false, error: "url 和 title 必填" }, 400);
  }

  const favicon = body.favicon || getFavicon(body.url);
  const tags = Array.isArray(body.tags) ? body.tags.join(",") : (body.tags || "");

  const result = await env.DB.prepare(
    "INSERT INTO bookmarks (url, title, description, category, tags, favicon) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(
    body.url,
    body.title,
    body.description || "",
    body.category || "未分类",
    tags,
    favicon
  ).run();

  return json({ success: true, data: { id: result.meta.last_row_id } });
}

async function handleUpdate(request, env, id) {
  const body = await request.json();
  const fields = [];
  const binds = [];

  for (const key of ["url", "title", "description", "category", "tags", "favicon"]) {
    if (body[key] !== undefined) {
      fields.push(`${key} = ?`);
      binds.push(key === "tags" && Array.isArray(body.tags) ? body.tags.join(",") : body[key]);
    }
  }

  if (!fields.length) {
    return json({ success: false, error: "没有要更新的字段" }, 400);
  }

  fields.push("updated_at = datetime('now')");
  binds.push(id);

  await env.DB.prepare(`UPDATE bookmarks SET ${fields.join(", ")} WHERE id = ?`).bind(...binds).run();
  return json({ success: true });
}

async function handleDelete(request, env, id) {
  await env.DB.prepare("DELETE FROM bookmarks WHERE id = ?").bind(id).run();
  return json({ success: true });
}

async function handleCategories(request, env) {
  const result = await env.DB.prepare(
    "SELECT DISTINCT category, COUNT(*) as count FROM bookmarks GROUP BY category ORDER BY count DESC"
  ).all();
  return json({ success: true, data: result.results });
}

async function handleTags(request, env) {
  const result = await env.DB.prepare("SELECT tags FROM bookmarks WHERE tags != ''").all();
  const tagMap = {};
  for (const row of result.results) {
    for (const tag of row.tags.split(",").map(t => t.trim()).filter(Boolean)) {
      tagMap[tag] = (tagMap[tag] || 0) + 1;
    }
  }
  const tags = Object.entries(tagMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  return json({ success: true, data: tags });
}

async function handleImport(request, env) {
  const body = await request.json();
  if (!Array.isArray(body)) {
    return json({ success: false, error: "需要书签数组" }, 400);
  }

  let imported = 0;
  for (const item of body) {
    if (!item.url || !item.title) continue;
    const favicon = getFavicon(item.url);
    const tags = Array.isArray(item.tags) ? item.tags.join(",") : (item.tags || "");
    await env.DB.prepare(
      "INSERT INTO bookmarks (url, title, description, category, tags, favicon) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(
      item.url,
      item.title,
      item.description || "",
      item.category || "未分类",
      tags,
      favicon
    ).run();
    imported++;
  }

  return json({ success: true, imported });
}

async function handleExport(request, env) {
  const result = await env.DB.prepare("SELECT * FROM bookmarks ORDER BY created_at DESC").all();
  return json({ success: true, data: result.results });
}

// ── 主入口 ──
export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace("/api", "") || "/";

  // CORS 预检
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    });
  }

  // 认证（除了 OPTIONS 已处理）
  if (!checkAuth(request, env)) {
    return json({ success: false, error: "未授权" }, 401);
  }

  // 路由
  try {
    // GET /api/bookmarks — 列表（搜索/分类/标签过滤）
    if (path === "/bookmarks" && request.method === "GET") {
      return await handleList(request, env);
    }

    // POST /api/bookmarks — 新建
    if (path === "/bookmarks" && request.method === "POST") {
      return await handleCreate(request, env);
    }

    // PUT /api/bookmarks/:id — 更新
    const updateMatch = path.match(/^\/bookmarks\/(\d+)$/);
    if (updateMatch && request.method === "PUT") {
      return await handleUpdate(request, env, parseInt(updateMatch[1]));
    }

    // DELETE /api/bookmarks/:id — 删除
    const deleteMatch = path.match(/^\/bookmarks\/(\d+)$/);
    if (deleteMatch && request.method === "DELETE") {
      return await handleDelete(request, env, parseInt(deleteMatch[1]));
    }

    // GET /api/categories — 分类列表
    if (path === "/categories" && request.method === "GET") {
      return await handleCategories(request, env);
    }

    // GET /api/tags — 标签列表
    if (path === "/tags" && request.method === "GET") {
      return await handleTags(request, env);
    }

    // POST /api/import — 批量导入
    if (path === "/import" && request.method === "POST") {
      return await handleImport(request, env);
    }

    // GET /api/export — 导出全部
    if (path === "/export" && request.method === "GET") {
      return await handleExport(request, env);
    }

    return json({ success: false, error: "未找到路由: " + path }, 404);
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
}
