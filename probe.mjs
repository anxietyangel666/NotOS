// Quick round-trip test of the compact pack-link encoding logic (mirrors the TS).
const EMOJI_GG_CDN = 'https://cdn3.emoji.gg/emojis';
const PACK_TOKEN_PREFIX = 'cep_';
const MAX = 1800;

function toBase64Url(s){return Buffer.from(s,'utf8').toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function fromBase64Url(s){const p=s.replace(/-/g,'+').replace(/_/g,'/');return Buffer.from(p,'base64').toString('utf8');}
function nameFromCdnFile(f){const b=f.replace(/\.[a-z0-9]+$/i,'');return b.replace(/^\d+[-_]/,'')||b;}
function cdnFileOf(e){const p=EMOJI_GG_CDN+'/';return e.url.startsWith(p)?e.url.slice(p.length):null;}

function build(pack, by){
  const ce = pack.emojis.map(e=>{const f=cdnFileOf(e); if(f&&nameFromCdnFile(f)===e.name)return{f}; return{u:e.url,n:e.name};});
  const enc=(em)=>{const c={v:1,n:pack.name,o:pack.origin??pack.id,e:em,by};return PACK_TOKEN_PREFIX+toBase64Url(JSON.stringify(c));};
  let token=enc(ce), em=ce;
  while(token.length>MAX && em.length>1){const keep=Math.max(1,Math.floor(em.length*(MAX/token.length)));em=em.slice(0,keep<em.length?keep:em.length-1);token=enc(em);}
  return token;
}
function decode(token){const c=JSON.parse(fromBase64Url(token.slice(4)));const emojis=c.e.map(it=>'f'in it?{id:`gg-pack-emoji-${it.f}`,name:nameFromCdnFile(it.f),url:`${EMOJI_GG_CDN}/${it.f}`}:{id:`url-${it.u}`,name:it.n,url:it.u});return{pack:{id:c.o,name:c.n,source:'custom',origin:c.o,emojis},sharedBy:c.by};}

// Build a large pack (60 emojis) like an emoji.gg import.
const emojis=Array.from({length:60},(_,i)=>({id:`gg-pack-emoji-${i}`,name:`emoji${i}`,url:`${EMOJI_GG_CDN}/${100000+i}-emoji${i}.png`}));
const pack={id:'gg-pack-430039',name:'Cats',source:'emoji.gg',emojis};
const by={id:'u1',name:'Alice'};
const token=build(pack,by);
console.log('emojis in:',emojis.length,'token length:',token.length,'<=1800:',token.length<=1800);
const back=decode(token);
console.log('decoded name:',back.pack.name,'emojis out:',back.pack.emojis.length);
console.log('first emoji round-trip:',JSON.stringify(back.pack.emojis[0]));
console.log('name derived ok:',back.pack.emojis[0].name==='emoji0');
