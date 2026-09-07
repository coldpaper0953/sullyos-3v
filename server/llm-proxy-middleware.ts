import type { IncomingMessage, ServerResponse } from 'http';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/**
 * LLM 转发中间件（模仿 SillyTavern 的 CUSTOM 源直连模式）：
 * POST /api/llm/proxy，body = { baseUrl, apiKey, payload, path }
 *
 * 酒馆能走 http:// 的原理 = 由 Node 服务端（而不是浏览器）发请求，没有混合内容
 * 限制。这里同款：前端把上游 baseUrl + apiKey + 请求体都发到本地服务，服务端
 * 原样转发到上游（含 SSE 流，逐块 pipe 回来），对 GitHub Pages / https 站点
 * 的混合内容限制和 CORS 都免疫。
 *
 * 请求头和酒馆 CUSTOM 源一致：Content-Type: application/json + Bearer（可选
 * X-Api-Key 兼容头由 payload.headers 透传）。上游返回什么状态码就回什么状态码。
 */
export async function llmProxyMiddleware(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }

  let upstreamUrl = '';
  try {
    const body = JSON.parse(await readBody(req));
    const { baseUrl, apiKey, payload, path: apiPath } = body;
    if (!baseUrl) throw new Error('Missing baseUrl');
    if (!payload) throw new Error('Missing payload');

    // 上游地址 = baseUrl + path（path 不传 = /chat/completions）；
    // baseUrl 末尾斜杠抹掉再拼，和酒馆处理 CUSTOM 源 URL 的做法一致。
    const base = String(baseUrl).trim().replace(/\/+$/, '');
    const p = String(apiPath || '/chat/completions');
    upstreamUrl = p.startsWith('/') ? base + p : base + '/' + p;
    // 只放行 http(s)，防 file:// / data: 之类的奇怪协议被灌进来。
    if (!/^https?:\/\//i.test(upstreamUrl)) throw new Error('baseUrl must be http(s)');

    // 信封里带 method:'GET'（拉模型列表）→ GET 转发、无 body；否则 POST + payload
    const httpMethod = String((body as any).method || payload.method || 'POST').toUpperCase();
    const isGet = httpMethod === 'GET';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: isGet ? 'application/json' : (payload.stream ? 'text/event-stream' : 'application/json'),
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    // 酒馆 custom_include_headers 等价物：调用方想加的非标准头放 payload.headers
    const extra = typeof payload.headers === 'object' && payload.headers ? payload.headers : {};
    for (const [k, v] of Object.entries(extra)) {
      if (typeof v === 'string' && k.toLowerCase() !== 'content-type' && k.toLowerCase() !== 'authorization') headers[k] = v;
    }
    // GET 的 method 标记不进上游 body；POST 时也剥掉（上游不该看到转发协议字段）
    const upstreamPayload = { ...payload };
    delete upstreamPayload.method;
    delete upstreamPayload.headers;
    const upstreamBody = isGet ? undefined : JSON.stringify(upstreamPayload);

    console.log(`[llm-proxy] ${httpMethod} ${upstreamUrl}`);
    const upstream = await fetch(upstreamUrl, {
      method: httpMethod,
      headers,
      ...(upstreamBody != null ? { body: upstreamBody } : {}),
    });

    // 上游状态原样回传；SSE（text/event-stream）逐块 pipe，其余整包回。
    res.statusCode = upstream.status;
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type');
    const ct = upstream.headers.get('content-type') || 'application/json';
    res.setHeader('Content-Type', ct);
    if (upstream.headers.get('content-encoding')) res.setHeader('X-Upstream-Encoding', upstream.headers.get('content-encoding')!);

    if (upstream.body?.getReader) {
      const reader = upstream.body.getReader();
      // 关键：不让 fetch 自动解压后再被我们标成 gzip（浏览器会二次解压报错）。
      // 直接透传上游原始字节；Content-Encoding 头已丢弃（见上，没回传）。
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
      console.log(`[llm-proxy] ${upstream.status} <- ${upstreamUrl} (piped)`);
      return;
    }
    const text = await upstream.text();
    res.end(text);
    console.log(`[llm-proxy] ${upstream.status} <- ${upstreamUrl}`);
  } catch (err: any) {
    console.error('[llm-proxy] error:', err?.message, upstreamUrl || '');
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err?.message || 'llm-proxy failed' }));
  }
}
