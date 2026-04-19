// Vercel serverless — POST /api/generate-blog
// Generates a long-form SEO-optimized blog post via Claude Sonnet 4.6.
// Returns { html, markdown, meta } and (optionally) persists to blog_posts.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey, authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {
    topic = '',
    strategy = '',
    seo_keyword = '',
    word_count = 1500,
    tone = 'Conversational',
    internal_links = [],
    image_count = 3,
    save = false,
    workspace_id = null,
    strategy_id = null,
    supabase_url = null,
    supabase_key = null,
  } = req.body || {};

  if (!topic.trim() && !strategy.trim()) {
    return res.status(400).json({error: 'Need a topic or strategy'});
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({error: 'ANTHROPIC_API_KEY not configured'});

  const targetWords = Math.max(400, Math.min(5000, parseInt(word_count) || 1500));
  const imgCount = Math.max(0, Math.min(8, parseInt(image_count) || 0));

  const system = `You are an expert SEO long-form blog writer. Output a single Markdown document. Rules:
- Open with a single H1 (#) headline that is SEO-optimized.
- Add an italicized one-sentence meta description right under the H1.
- Section every ~250-350 words with H2 (##) headings. Use H3 (###) for sub-points.
- Open with a hook paragraph (curiosity + benefit + reader payoff).
- Cite specific numbers, named examples, or short case studies when possible.
- Insert exactly ${imgCount} image placeholder(s) inline at natural breaks using this exact syntax: {{IMAGE: detailed visual prompt for an illustration}}
- Close with a clear CTA section (## Next Steps or ## Take Action).
- Tone: ${tone}.
- Target length: approximately ${targetWords} words (do not include the meta description in the count).
- Primary SEO keyword: ${seo_keyword || '(infer from topic)'}.
- Internal link suggestions to weave in naturally where relevant: ${(internal_links || []).slice(0,8).join(', ') || '(none)'}.
- Output ONLY the Markdown. Do not wrap in code fences. Do not add commentary.`;

  const userMsg = strategy
    ? `Write the blog post based on this content strategy:\n\n${strategy.slice(0, 6000)}\n\nBlog topic: ${topic || '(use the strategy title)'}.`
    : `Write the blog post on: ${topic}`;

  let markdown = '';
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 8000,
        system,
        messages: [{role: 'user', content: userMsg}],
      })
    });
    if (!r.ok) {
      const err = await r.text();
      return res.status(r.status).json({error: 'Anthropic call failed', details: err});
    }
    const data = await r.json();
    markdown = (data?.content?.[0]?.text || '').trim();
    if (!markdown) return res.status(500).json({error: 'Empty response from Claude'});
  } catch (e) {
    return res.status(500).json({error: 'Anthropic request error: ' + e.message});
  }

  // ----- Extract image prompts -----
  const imagePrompts = [];
  markdown = markdown.replace(/\{\{IMAGE:\s*([^}]+)\}\}/g, (_, prompt) => {
    const idx = imagePrompts.length;
    imagePrompts.push(prompt.trim());
    return `\n\n![Image ${idx + 1}](image-${idx + 1}-placeholder)\n\n`;
  });

  // ----- Derive meta -----
  const titleMatch = markdown.match(/^#\s+(.+?)$/m);
  const title = (titleMatch ? titleMatch[1] : topic || 'Untitled').trim();
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

  // First non-heading paragraph that isn't the meta-description italic line
  const paragraphs = markdown
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p && !p.startsWith('#') && !p.startsWith('!['));
  const metaDescription = (paragraphs[0] || title)
    .replace(/^[*_]+|[*_]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 160);

  const wordCount = markdown.split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 220));

  const html = markdownToHtml(markdown);
  const headings = [...markdown.matchAll(/^(#{1,3})\s+(.+)$/gm)].map(m => ({
    level: m[1].length,
    text: m[2].trim(),
  }));

  const meta = {
    title,
    slug,
    description: metaDescription,
    word_count: wordCount,
    reading_time: readingTime,
    image_prompts: imagePrompts,
    headings,
    seo_keyword: seo_keyword || null,
    tone,
    model: 'claude-sonnet-4-5-20250929',
    generated_at: new Date().toISOString(),
  };

  // ----- Persist (optional) -----
  let postId = null;
  if (save && supabase_url && supabase_key) {
    try {
      const r = await fetch(`${supabase_url}/rest/v1/blog_posts`, {
        method: 'POST',
        headers: {
          'apikey': supabase_key,
          'Authorization': `Bearer ${supabase_key}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          workspace_id, strategy_id,
          title, slug, html, markdown, meta,
        })
      });
      if (r.ok) {
        const data = await r.json();
        postId = data?.[0]?.id;
      } else {
        const err = await r.text();
        console.warn('blog_posts insert failed:', r.status, err);
      }
    } catch (e) {
      console.warn('blog_posts insert error:', e.message);
    }
  }

  return res.status(200).json({ok: true, id: postId, html, markdown, meta});
}

// ============================================================
// Minimal Markdown -> HTML (no deps).
// Handles: H1-H3, bold, italic, inline code, links, images, lists, blockquotes, paragraphs.
// ============================================================
function markdownToHtml(md) {
  const escapeAttr = (s) => String(s).replace(/"/g, '&quot;');
  const lines = md.split('\n');
  const out = [];
  let i = 0;

  const inline = (s) => s
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" />`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, href) => `<a href="${escapeAttr(href)}" target="_blank" rel="noopener">${txt}</a>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>');

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    let m;
    if ((m = line.match(/^#\s+(.+)$/))) { out.push(`<h1>${inline(m[1])}</h1>`); i++; continue; }
    if ((m = line.match(/^##\s+(.+)$/))) { out.push(`<h2>${inline(m[1])}</h2>`); i++; continue; }
    if ((m = line.match(/^###\s+(.+)$/))) { out.push(`<h3>${inline(m[1])}</h3>`); i++; continue; }
    if (line.match(/^>\s+/)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^>\s*/)) {
        items.push(inline(lines[i].replace(/^>\s?/, '')));
        i++;
      }
      out.push(`<blockquote>${items.join('<br/>')}</blockquote>`);
      continue;
    }
    if (line.match(/^[-*]\s+/)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^[-*]\s+/)) {
        items.push(`<li>${inline(lines[i].replace(/^[-*]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (line.match(/^\d+\.\s+/)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
        items.push(`<li>${inline(lines[i].replace(/^\d+\.\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // paragraph: collect contiguous non-empty lines that aren't another block
    const paraLines = [];
    while (i < lines.length && lines[i].trim() && !lines[i].match(/^(#{1,6}\s|>\s|[-*]\s|\d+\.\s)/)) {
      paraLines.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(paraLines.join(' '))}</p>`);
  }
  return out.join('\n');
}
