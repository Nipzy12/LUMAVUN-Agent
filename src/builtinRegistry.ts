import type { Connector } from './featureState';

/** Curated, immutable references. Listing does not install or execute upstream code. */
export type BuiltinCategory = 'mcp' | 'skill' | 'agent' | 'media' | 'model' | 'automation';
export type BuiltinStatus = 'mcp-ready' | 'instructions' | 'server-needed' | 'reference-only';
export type BuiltinReference = Readonly<{
  id: string; name: string; repo: string; category: BuiltinCategory;
  status: BuiltinStatus; summary: string; requirements: string; prompt?: string;
}>;
export const EXA_MCP_URL = 'https://mcp.exa.ai/mcp';
export const BUILTIN_EXA_CONNECTOR: Connector = Object.freeze({
  id: 'builtin_exa_search', name: 'Exa Web Search (bawaan)', url: EXA_MCP_URL,
  enabled: true, toolCount: 0, verified: false
});
const item = (x: BuiltinReference) => Object.freeze(x);
/** Product integration registry. Entries cannot be removed/edited in the Android UI. */
export const BUILTIN_REFERENCES: readonly BuiltinReference[] = Object.freeze([
  item({id:'exa',name:'Exa MCP',repo:'exa-labs/exa-mcp-server',category:'mcp',status:'mcp-ready',
    summary:'Pencarian web dan ekstraksi halaman melalui MCP hosted.',requirements:'Internet. Akses anonim dibatasi; OAuth/API key mungkin diperlukan untuk batas lebih tinggi.'}),
  item({id:'open-websearch',name:'Open-WebSearch',repo:'Aas-ee/open-webSearch',category:'mcp',status:'server-needed',
    summary:'Pencarian multi-engine, fetch halaman, dan skill penelusuran.',requirements:'Node.js/npm atau daemon HTTP/MCP yang kamu jalankan di server terpisah.'}),
  item({id:'heventure',name:'Heventure Search MCP',repo:'HughesCuit/heventure-search-mcp',category:'mcp',status:'server-needed',
    summary:'Pencarian DuckDuckGo/Bing/Google dan ekstraksi halaman.',requirements:'Python atau Docker MCP server; tidak otomatis berjalan di dalam APK.'}),
  item({id:'zimzilla',name:'ZimZilla',repo:'Mr-Destroyer/ZimZilla',category:'agent',status:'server-needed',
    summary:'Agent coding terminal dengan inspeksi kode, shell, dan browser.',requirements:'Python dan lingkungan terminal Linux/macOS; fitur shell tidak dieksekusi oleh APK.'}),
  item({id:'uncensored-ai',name:'Uncensored AI',repo:'AnkitNayak-dev/Uncensored-ai',category:'agent',status:'reference-only',
    summary:'Contoh antarmuka AI web pihak ketiga. Tidak mengaktifkan model atau mengubah pengamanan provider.',requirements:'Runtime web dan akses model sendiri. Payload bypass dan instruksi tidak tepercaya tidak diimpor.'}),
  item({id:'openjutsu',name:'Openjutsu',repo:'D3voz/openjutsu',category:'media',status:'server-needed',
    summary:'Editor karakter dan objek video berbasis ComfyUI.',requirements:'Server ComfyUI dengan node, model, serta GPU yang sesuai.'}),
  item({id:'kimi-k3',name:'Kimi K3 in C',repo:'FareedKhan-dev/kimi-k3-in-c',category:'model',status:'reference-only',
    summary:'Engine inferensi C99 eksperimental; bukan model GGUF siap unduh ke ponsel.',requirements:'Checkpoint berukuran sangat besar, storage dan performa I/O memadai; tidak termasuk APK.'}),
  item({id:'wan2',name:'Wan2.2',repo:'Wan-Video/Wan2.2',category:'media',status:'server-needed',
    summary:'Model generasi video teks/gambar/video melalui worker GPU.',requirements:'PyTorch/GPU dan checkpoint Wan2.2 di worker terpisah.'}),
  item({id:'voicestudio',name:'VoiceStudio',repo:'debpalash/VoiceStudio',category:'media',status:'server-needed',
    summary:'Studio sintesis suara, dubbing, transkripsi, dan narasi.',requirements:'Aplikasi/worker VoiceStudio sendiri, periksa lisensi dan perangkat yang didukung.'}),
  item({id:'comfyui',name:'ComfyUI',repo:'Comfy-Org/ComfyUI',category:'media',status:'server-needed',
    summary:'Engine workflow gambar/video/audio generatif dengan API lokal/server.',requirements:'Host ComfyUI dan model GPU/CPU yang sesuai; pakai gateway aman untuk remote.'}),
  item({id:'artemis',name:'Artemis Android Automation',repo:'google/artemis',category:'automation',status:'server-needed',
    summary:'Pengujian dan pengendalian perangkat Android melalui MCP dan server operator.',requirements:'Python, ADB, perangkat terotorisasi, dan host bridge; tidak mengendalikan HP ini otomatis.'}),
  item({id:'vibe-trading',name:'Vibe-Trading',repo:'HKUDS/Vibe-Trading',category:'agent',status:'server-needed',
    summary:'Kerangka agent trading dan analisis/riset pasar berbasis Python.',requirements:'Backend Python atau MCP server, data pasar nyata, dan konfirmasi order.'}),
  item({id:'trader-skill',name:'Trader Skill',repo:'Jakeschincariol/trader-skill',category:'skill',status:'instructions',
    summary:'Panduan risiko, anggaran, evaluasi emiten dan trading paper-first.',requirements:'Instruksi bawaan tersedia; skrip Python dan data pasar tidak otomatis tersedia.',
    prompt:'Untuk permintaan trading: nyatakan asumsi harga dan biaya; bedakan analisis dengan order; periksa risiko, ukuran posisi, drawdown dan sumber data. Jangan klaim backtest tanpa data, dan jangan melakukan order tanpa izin jelas.'}),
  item({id:'replica-skill',name:'Replica Skill',repo:'Jakeschincariol/replica-skill',category:'skill',status:'instructions',
    summary:'Panduan analisis fitur, arsitektur, implementasi dan verifikasi aplikasi.',requirements:'Instruksi bawaan tersedia; skrip repo dan browser tidak otomatis tersedia.',
    prompt:'Untuk rekreasi aplikasi: pahami fungsi dari materi yang diizinkan, lakukan desain clean-room, implementasi kecil dan dapat diuji. Jangan menyalin aset atau kode pihak lain; verifikasi hasil dan laporkan keterbatasan.'})
]);

export function builtinById(id: string): BuiltinReference | undefined {
  return BUILTIN_REFERENCES.find(x => x.id === id);
}
export function allResearchConnectors(custom: Connector[]): Connector[] {
  return [...custom.filter(c=>c.enabled && c.id!==BUILTIN_EXA_CONNECTOR.id), BUILTIN_EXA_CONNECTOR];
}
/** Scope immutable skills by intent; never run upstream code or copy its system prompts. */
export function builtinGuidance(question: string): string {
  const text = question.toLowerCase();
  const relevant = BUILTIN_REFERENCES.filter(x=>x.prompt && (
    (x.id==='trader-skill' && /trading|trader|saham|market|forex|btc|crypto|backtest|broker|risiko|lot\b/.test(text)) ||
    (x.id==='replica-skill' && /clone|replik|tiruan|aplikasi|website|apk|frontend|backend|ui\b|desain|kode|coding/.test(text))
  ));
  return relevant.length ? '\n\nPanduan metodologi bawaan (bukan tool eksekusi):\n' +
    relevant.map(x=>'['+x.name+'] '+x.prompt).join('\n') : '';
}
export function modelIdentityAnswer(question:string,modelId:string,modelName:string,isLocal:boolean):string|null {
  const text=question.toLowerCase().trim().replace(/[?!.,]+/g,'');
  const direct = /^(?:model (?:apa|yang (?:ku|aku|saya|kamu|kau) gunakan|yang digunakan|kamu apa)|sebutkan (?:nama )?model(?: kamu)?|kamu (?:pakai|menggunakan) model apa|apa (?:nama )?model(?:mu| kamu)?|model yang (?:ku|aku|saya) (?:pakai|gunakan) apa|kamu (?:model|ai) apa|mia siapa|kenapa bukan qwen2?\.?5)/.test(text);
  if(!direct || !modelId)return null;
  return 'Model yang dipilih di aplikasi LUMAVUN adalah **'+modelName+'** (ID: '+modelId+'). '+
    (isLocal?'Ini model GGUF yang berjalan di perangkat, bukan model bernama Mia.':
    'Ini adalah ID model dari pengaturan provider; penyedia dapat melakukan routing internal.')+
    ' LUMAVUN adalah nama aplikasinya, bukan nama model dasar.';
}
