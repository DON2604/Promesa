#!/usr/bin/env node
/**
 * Builds the YouTube video from `record-demo.mjs` output: one clip per scene (labelled browser
 * view, side-by-side for two-browser moments, fast-forward for PayPal waits), the neural voice-over,
 * then a single 1080p30 H.264/AAC MP4 plus captions (.srt) and YouTube chapters.
 *
 *   node scripts/video/build-demo.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'out', 'video');
const WORK = join(OUT, 'work');
const BUILD = join(WORK, 'build');
const FPS = 30;
const W = 1920;
const H = 1080;

const { scenes, frames } = JSON.parse(readFileSync(join(WORK, 'manifest.json'), 'utf8'));
rmSync(BUILD, { recursive: true, force: true });
mkdirSync(BUILD, { recursive: true });

const ff = (args) =>
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
const fwd = (p) => p.replace(/\\/g, '/');
/** Path inside a filtergraph option: forward slashes and an escaped drive colon. */
const fpath = (p) => fwd(p).replace(/:/g, '\\:');
const FONT_BOLD = fpath('C:/Windows/Fonts/segoeuib.ttf');
const FONT = fpath('C:/Windows/Fonts/segoeui.ttf');

let textN = 0;
function textFile(text) {
  const f = join(BUILD, `text-${textN++}.txt`);
  writeFileSync(f, text, 'utf8');
  return fpath(f);
}

/** Concat-demuxer list that shows each captured frame until the next one arrives. */
function rawClip(name, s, e, out) {
  const list = frames[name];
  let i0 = -1;
  for (let i = 0; i < list.length; i++) if (list[i].t <= s + 0.001) i0 = i;
  if (i0 < 0) i0 = list.findIndex((f) => f.t >= s);
  if (i0 < 0) throw new Error(`No frames for ${name} in ${s}–${e}`);
  const picked = [];
  for (let i = i0; i < list.length && (i === i0 || list[i].t < e); i++) picked.push(list[i]);
  let body = '';
  picked.forEach((f, k) => {
    const from = Math.max(f.t, s);
    const to = k + 1 < picked.length ? picked[k + 1].t : e;
    body += `file '${fwd(f.f)}'\nduration ${Math.max(to - from, 0.001).toFixed(4)}\n`;
  });
  body += `file '${fwd(picked.at(-1).f)}'\n`;
  const listFile = join(BUILD, `${name}-${out}.txt`);
  writeFileSync(listFile, body);
  const file = join(BUILD, `${out}-${name}.mp4`);
  ff([
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listFile,
    '-vf',
    `fps=${FPS},scale=${W}:${H}:flags=lanczos,setsar=1,format=yuv420p`,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '16',
    '-an',
    file,
  ]);
  return file;
}

const pill = (file, x, y, size = 28) =>
  `drawtext=fontfile='${FONT_BOLD}':textfile='${file}':fontsize=${size}:fontcolor=white:box=1:boxcolor=0x0B1020@0.84:boxborderw=16:x=${x}:y=${y}`;

const clips = [];
const captions = [];
const chapters = [];
let cursor = 0;

const MAX_SECONDS = 180;
const CHAPTER = {
  intro: 'The problem',
  studio: 'The requester describes the need',
  plan: 'AI agents plan the purchase',
  'plan-result': 'AI agents plan the purchase',
  'priya-signin': 'Sponsor authorizes on PayPal (Sandbox)',
  fund: 'Sponsor authorizes on PayPal (Sandbox)',
  authorized: 'Sponsor authorizes on PayPal (Sandbox)',
  merchant: 'Stockout: AI recovery voids and re-plans',
  stockout: 'Stockout: AI recovery voids and re-plans',
  replan: 'Stockout: AI recovery voids and re-plans',
  'approve-3': 'Stockout: AI recovery voids and re-plans',
  capture: 'Merchants accept: capture on confirmed stock',
  receive: 'Delivery and the Mission Receipt',
  receipt: 'Delivery and the Mission Receipt',
  outro: 'Wrap-up',
};
const chapterOf = (id) => CHAPTER[id] ?? id;

scenes.forEach((sc, idx) => {
  const recDur = sc.end - sc.start;
  const target = sc.audioDur + 0.7;
  const factor = sc.speed && recDur > target ? Math.min(recDur / target, sc.maxSpeed ?? 12) : 1;
  const videoDur = recDur / factor;
  const pad = Math.max(0, sc.audioDur + 0.5 - videoDur);
  const total = videoDur + pad;
  const name = `scene-${String(idx).padStart(2, '0')}-${sc.id}`;
  const first = idx === 0;
  const last = idx === scenes.length - 1;
  const fades = [
    first ? 'fade=t=in:st=0:d=0.8' : null,
    last ? `fade=t=out:st=${(total - 1).toFixed(3)}:d=1` : null,
  ].filter(Boolean);
  const timing = `setpts=PTS/${factor.toFixed(5)},tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)}`;
  const ffwd =
    factor > 1.3
      ? `,${pill(textFile(`▶▶  fast-forward ×${Math.round(factor)}`), 'w-tw-40', 36, 24)}`
      : '';

  const inputs = [];
  let graph;
  if (sc.view === 'split') {
    inputs.push(rawClip('A', sc.start, sc.end, name), rawClip('B', sc.start, sc.end, name));
    const sw = 940;
    const sh = Math.round((sw * H) / W);
    const top = 250;
    graph = [
      `[0:v]${timing},scale=${sw}:${sh}:flags=lanczos,drawbox=c=0x334155:t=2[a]`,
      `[1:v]${timing},scale=${sw}:${sh}:flags=lanczos,drawbox=c=0x334155:t=2[b]`,
      `color=c=0x0B1020:s=${W}x${H}:r=${FPS}:d=${total.toFixed(3)}[bg]`,
      `[bg][a]overlay=x=13:y=${top}[t1]`,
      `[t1][b]overlay=x=${W - sw - 13}:y=${top}[t2]`,
      `[t2]drawtext=fontfile='${FONT_BOLD}':textfile='${textFile('Two browsers · two people · one live mission')}':fontsize=44:fontcolor=white:x=(w-tw)/2:y=90,` +
        `drawtext=fontfile='${FONT}':textfile='${textFile('Each browser has its own signed-in session. Updates arrive live.')}':fontsize=26:fontcolor=0x94A3B8:x=(w-tw)/2:y=150,` +
        `${pill(textFile(sc.labelA), 13, top - 58, 22)},${pill(textFile(sc.labelB), W - sw - 13, top - 58, 22)}${ffwd}` +
        `${fades.length ? `,${fades.join(',')}` : ''}[v]`,
    ].join(';');
  } else {
    inputs.push(rawClip(sc.view, sc.start, sc.end, name));
    const lbl = sc.card ? '' : sc.view === 'A' ? sc.labelA : sc.labelB;
    const chain = [timing, lbl ? pill(textFile(lbl), 36, 'h-th-48') : null, ...fades].filter(
      Boolean,
    );
    graph = `[0:v]${chain.join(',')}${ffwd}[v]`;
  }
  const audioIn = inputs.length;
  const afade = last ? `,afade=t=out:st=${(total - 1).toFixed(3)}:d=1` : '';
  graph += `;[${audioIn}:a]adelay=250|250,apad,atrim=0:${total.toFixed(3)},aformat=sample_rates=48000:channel_layouts=stereo${afade}[aout]`;

  const out = join(BUILD, `${name}.mp4`);
  writeFileSync(join(BUILD, `${name}.graph.txt`), graph);
  ff([
    ...inputs.flatMap((f) => ['-i', f]),
    '-i',
    sc.audio,
    '-filter_complex_script',
    join(BUILD, `${name}.graph.txt`),
    '-map',
    '[v]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-r',
    String(FPS),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-t',
    total.toFixed(3),
    out,
  ]);
  clips.push(out);
  console.log(`${name}: ${total.toFixed(1)}s${factor > 1 ? ` (×${factor.toFixed(1)})` : ''}`);

  const chapter = chapterOf(sc.id);
  if (chapters.at(-1)?.title !== chapter) chapters.push({ title: chapter, at: cursor });

  const sentences = sc.text
    .split(/(?<=[.!?:])\s+/)
    .flatMap((s) => (s.length > 95 ? s.split(/(?<=,)\s+/) : [s]))
    .filter(Boolean);
  const chars = sentences.reduce((a, s) => a + s.length, 0);
  let t = cursor + 0.25;
  for (const s of sentences) {
    const d = (s.length / chars) * sc.audioDur;
    captions.push({ from: t, to: t + d, text: s });
    t += d;
  }
  cursor += total;
});

const listFile = join(BUILD, 'scenes.txt');
writeFileSync(listFile, clips.map((c) => `file '${fwd(c)}'`).join('\n'));
const video = join(OUT, 'needmesh-demo.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', video]);

const ts = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
writeFileSync(
  join(OUT, 'needmesh-demo.srt'),
  captions.map((c, i) => `${i + 1}\n${ts(c.from)} --> ${ts(c.to)}\n${c.text}\n`).join('\n'),
);

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const merged = chapters.filter((c, i) => i === 0 || (chapters[i + 1]?.at ?? cursor) - c.at >= 10);
writeFileSync(
  join(OUT, 'youtube-description.txt'),
  `NeedMesh turns a community's need into a purchase that protects itself, with AI finding the sellers and PayPal holding the money until the goods are real.

End to end, with three people in two browsers. Jordan requests the supplies. AI agents plan the purchase and Gemini explains it, with every figure checked against the planner. Priya accepts and authorizes each order, so the money is held but not taken. A merchant reports a stockout, the Recovery agent releases that hold and re-plans, and Priya approves the replacement. The merchants then confirm real stock, the payment is captured, the orders ship, and Jordan confirms delivery on the Mission Receipt.

Chapters
${merged.map((c) => `${mmss(c.at)} ${c.title}`).join('\n')}

Built with: PayPal Orders v2, Payments v2 (authorize, capture, void, refund), PayPal MCP server, PayPal webhooks, Google Gemini, Channel3, NestJS, Next.js, PostgreSQL.
`,
);
console.log(`\n${video} (${mmss(cursor)})`);
if (cursor >= MAX_SECONDS) {
  console.error(`Video is ${mmss(cursor)}, over the ${mmss(MAX_SECONDS)} limit.`);
  process.exit(1);
}
