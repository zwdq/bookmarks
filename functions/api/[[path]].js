// 书签管理 API — CF Pages Functions
// 路由: /api/*

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
  return token === (env.ACCESS_PASSWORD || "shaduanduan123");
}

function getDomain(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

function getFavicon(url) {
  const domain = getDomain(url);
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : "";
}

// ── 书签 CRUD ──

async function handleList(request, env) {
  const result = await env.DB.prepare("SELECT * FROM bookmarks ORDER BY created_at DESC").all();
  return json({ success: true, data: result.results });
}

async function handleCreate(request, env) {
  const body = await request.json();
  if (!body.url || !body.title) return json({ success: false, error: "url 和 title 必填" }, 400);
  const favicon = body.favicon || getFavicon(body.url);
  const tags = Array.isArray(body.tags) ? body.tags.join(",") : (body.tags || "");
  const result = await env.DB.prepare(
    "INSERT INTO bookmarks (url, title, description, category, tags, favicon, folder_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(body.url, body.title, body.description || "", body.category || "未分类", tags, favicon, body.folder_id || null).run();
  return json({ success: true, data: { id: result.meta.last_row_id } });
}

async function handleUpdate(request, env, id) {
  const body = await request.json();
  const fields = [];
  const binds = [];
  for (const key of ["url", "title", "description", "category", "tags", "favicon", "folder_id"]) {
    if (body[key] !== undefined) {
      fields.push(`${key} = ?`);
      binds.push(key === "tags" && Array.isArray(body.tags) ? body.tags.join(",") : body[key]);
    }
  }
  if (!fields.length) return json({ success: false, error: "没有要更新的字段" }, 400);
  fields.push("updated_at = datetime('now')");
  binds.push(id);
  await env.DB.prepare(`UPDATE bookmarks SET ${fields.join(", ")} WHERE id = ?`).bind(...binds).run();
  return json({ success: true });
}

async function handleDelete(request, env, id) {
  await env.DB.prepare("DELETE FROM bookmarks WHERE id = ?").bind(id).run();
  return json({ success: true });
}

async function handleExport(request, env) {
  const bookmarks = await env.DB.prepare("SELECT * FROM bookmarks ORDER BY created_at DESC").all();
  const folders = await env.DB.prepare("SELECT * FROM folders ORDER BY sort_order, id").all();
  return json({ success: true, data: { bookmarks: bookmarks.results, folders: folders.results } });
}

// ── 文件夹 CRUD ──

async function handleFolderList(request, env) {
  const result = await env.DB.prepare("SELECT * FROM folders ORDER BY sort_order, id").all();
  return json({ success: true, data: result.results });
}

async function handleFolderCreate(request, env) {
  const body = await request.json();
  if (!body.name) return json({ success: false, error: "name 必填" }, 400);
  const result = await env.DB.prepare(
    "INSERT INTO folders (name, parent_id, sort_order) VALUES (?, ?, ?)"
  ).bind(body.name, body.parent_id || null, body.sort_order || 0).run();
  return json({ success: true, data: { id: result.meta.last_row_id } });
}

async function handleFolderUpdate(request, env, id) {
  const body = await request.json();
  const fields = [];
  const binds = [];
  for (const key of ["name", "parent_id", "sort_order"]) {
    if (body[key] !== undefined) { fields.push(`${key} = ?`); binds.push(body[key]); }
  }
  if (!fields.length) return json({ success: false, error: "没有要更新的字段" }, 400);
  binds.push(id);
  await env.DB.prepare(`UPDATE folders SET ${fields.join(", ")} WHERE id = ?`).bind(...binds).run();
  return json({ success: true });
}

async function handleFolderDelete(request, env, id) {
  // 递归删除子文件夹 + 把子书签移到根
  async function deleteRecursive(folderId) {
    const children = await env.DB.prepare("SELECT id FROM folders WHERE parent_id = ?").bind(folderId).all();
    for (const child of children.results) {
      await deleteRecursive(child.id);
    }
    await env.DB.prepare("UPDATE bookmarks SET folder_id = NULL WHERE folder_id = ?").bind(folderId).run();
    await env.DB.prepare("DELETE FROM folders WHERE id = ?").bind(folderId).run();
  }
  await deleteRecursive(id);
  return json({ success: true });
}

// ── 标签 ──
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

// ── 导入 ──

async function handleImport(request, env) {
  const contentType = request.headers.get("content-type") || "";
  let imported = 0;
  let format = "json";

  if (contentType.includes("text/html") || contentType.includes("text/plain")) {
    const html = await request.text();
    const result = await importHTML(html, env);
    imported = result.imported;
    format = "html";
  } else {
    const body = await request.json();
    if (Array.isArray(body)) {
      for (const item of body) {
        if (!item.url || !item.title) continue;
        const favicon = item.favicon || getFavicon(item.url);
        const tags = Array.isArray(item.tags) ? item.tags.join(",") : (item.tags || "");
        await env.DB.prepare(
          "INSERT INTO bookmarks (url, title, description, category, tags, favicon, folder_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(item.url, item.title, item.description || "", item.category || "未分类", tags, favicon, item.folder_id || null).run();
        imported++;
      }
    }
  }
  return json({ success: true, imported, format });
}

// 解析 Chrome/Edge Netscape HTML，支持多层嵌套
async function importHTML(html, env) {
  const lines = html.split("\n");
  const folderStack = [null]; // 根
  let imported = 0;

  for (const line of lines) {
    // 进入文件夹 <DT><H3>名称</H3>
    const h3Match = line.match(/<H3[^>]*>(.+?)<\/H3>/i);
    if (h3Match) {
      const name = h3Match[1].trim();
      const parentId = folderStack[folderStack.length - 1];
      const result = await env.DB.prepare(
        "INSERT INTO folders (name, parent_id) VALUES (?, ?)"
      ).bind(name, parentId).run();
      folderStack.push(result.meta.last_row_id);
      continue;
    }

    // 退出文件夹 </DL>
    if (/<\/DL>/i.test(line)) {
      if (folderStack.length > 1) folderStack.pop();
      continue;
    }

    // 书签链接 <DT><A HREF="...">标题</A>
    const aMatch = line.match(/<A[^>]*HREF="([^"]+)"[^>]*>(.+?)<\/A>/i);
    if (aMatch) {
      const url = aMatch[1];
      const title = aMatch[2].replace(/<[^>]+>/g, "").trim();
      if (!url || url === "undefined" || !title) continue;

      const iconMatch = line.match(/ICON="([^"]+)"/i);
      const favicon = iconMatch ? iconMatch[1] : getFavicon(url);
      const folderId = folderStack[folderStack.length - 1];

      await env.DB.prepare(
        "INSERT INTO bookmarks (url, title, description, category, tags, favicon, folder_id) VALUES (?, ?, '', ?, '', ?, ?)"
      ).bind(url, title, "导入", favicon, folderId).run();
      imported++;
    }
  }
  return { imported };
}

// ── 主入口 ──
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace("/api", "") || "/";

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

  if (!checkAuth(request, env)) return json({ success: false, error: "未授权" }, 401);

  try {
    // 书签
    if (path === "/bookmarks" && request.method === "GET") return await handleList(request, env);
    if (path === "/bookmarks" && request.method === "POST") return await handleCreate(request, env);
    const bmMatch = path.match(/^\/bookmarks\/(\d+)$/);
    if (bmMatch && request.method === "PUT") return await handleUpdate(request, env, parseInt(bmMatch[1]));
    if (bmMatch && request.method === "DELETE") return await handleDelete(request, env, parseInt(bmMatch[1]));

    // 文件夹
    if (path === "/folders" && request.method === "GET") return await handleFolderList(request, env);
    if (path === "/folders" && request.method === "POST") return await handleFolderCreate(request, env);
    const fdMatch = path.match(/^\/folders\/(\d+)$/);
    if (fdMatch && request.method === "PUT") return await handleFolderUpdate(request, env, parseInt(fdMatch[1]));
    if (fdMatch && request.method === "DELETE") return await handleFolderDelete(request, env, parseInt(fdMatch[1]));

    // 标签
    if (path === "/tags" && request.method === "GET") return await handleTags(request, env);

    // 导入导出
    if (path === "/import" && request.method === "POST") return await handleImport(request, env);
    if (path === "/export" && request.method === "GET") return await handleExport(request, env);

    return json({ success: false, error: "未找到路由: " + path }, 404);
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
}
