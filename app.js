// =========================================================
// Lex Revisão v2 — app.js
// IndexedDB (Dexie) · Matérias pré-cadastradas · Importação em massa
// Certo/Errado + Múltipla escolha · SRS por data civil (sem hora)
// Backup/Restore sem login · Estatísticas com Chart.js
// =========================================================

const app = document.getElementById("app");

// ---------------------------------------------------------
// Firebase (login com Google + sincronização automática)
// ---------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyBs1NsTJabATbZ4dLkfmvb-9Oy7LYtztZk",
  authDomain: "lex-revisao.firebaseapp.com",
  projectId: "lex-revisao",
  storageBucket: "lex-revisao.firebasestorage.app",
  messagingSenderId: "305702167640",
  appId: "1:305702167640:web:1b9d8c9463bdb5ba7cd62d",
};
let firebaseApp = null;
let firebaseAuth = null;
let firebaseDb = null;
let usuarioLogado = null; // {uid, email, nome} ou null
let ultimoTimestampSincronizado = 0;
let pararEscutaNuvem = null; // função pra cancelar o listener do Firestore
let timerEnvioNuvem = null;

function configurarFirebase() {
  try {
    if (typeof firebase === "undefined") return; // SDK não carregou (ex: sem internet)
    firebaseApp = firebase.initializeApp(firebaseConfig);
    firebaseAuth = firebase.auth();
    firebaseDb = firebase.firestore();
    firebaseAuth.onAuthStateChanged((user) => {
      if (user) {
        usuarioLogado = { uid: user.uid, email: user.email, nome: user.displayName };
        iniciarEscutaNuvem(user.uid);
      } else {
        usuarioLogado = null;
        if (pararEscutaNuvem) { pararEscutaNuvem(); pararEscutaNuvem = null; }
      }
      if (estado.tela === "backup") renderizar();
    });
  } catch (e) {
    console.warn("Firebase indisponível:", e);
  }
}

async function entrarComGoogle() {
  if (!firebaseAuth) return { erro: "Firebase não carregou (verifique sua internet)." };
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await firebaseAuth.signInWithPopup(provider);
    return { ok: true };
  } catch (e) {
    return { erro: e.message || "Não foi possível entrar." };
  }
}
async function sairDaConta() {
  if (firebaseAuth) await firebaseAuth.signOut();
}

function iniciarEscutaNuvem(uid) {
  if (pararEscutaNuvem) pararEscutaNuvem();
  const ref = firebaseDb.collection("usuarios").doc(uid);
  pararEscutaNuvem = ref.onSnapshot(async (snap) => {
    const dados = snap.data();
    if (!dados) {
      // Nada na nuvem ainda: se este aparelho já tem questões, envia agora
      // (sem isso, dados criados ANTES do login nunca subiam sozinhos).
      if (CACHE_QUESTOES.length > 0 || CACHE_MATERIAS.length > 0) {
        await enviarParaNuvem();
      }
      return;
    }
    if ((dados.atualizadoEm || 0) > ultimoTimestampSincronizado) {
      await Store.substituirTudoLocal(dados.materias || [], dados.questoes || [], dados.projetos || []);
      ultimoTimestampSincronizado = dados.atualizadoEm;
      await Store.setConfig("firebaseUltimoSyncTs", ultimoTimestampSincronizado);
      await carregarTudo();
      if (estado.tela !== "sessao") renderizar();
    }
  }, (err) => console.warn("Erro ao escutar nuvem:", err));
}

function agendarEnvioNuvem() {
  if (!usuarioLogado || !firebaseDb) return;
  clearTimeout(timerEnvioNuvem);
  timerEnvioNuvem = setTimeout(enviarParaNuvem, 1500);
}
async function enviarParaNuvem() {
  if (!usuarioLogado || !firebaseDb) return;
  const agora = Date.now();
  const payload = {
    materias: CACHE_MATERIAS,
    questoes: CACHE_QUESTOES,
    projetos: CACHE_PROJETOS,
    atualizadoEm: agora,
  };
  try {
    await firebaseDb.collection("usuarios").doc(usuarioLogado.uid).set(payload);
    ultimoTimestampSincronizado = agora;
    await Store.setConfig("firebaseUltimoSyncTs", agora);
  } catch (e) {
    console.warn("Falha ao sincronizar com a nuvem:", e);
  }
}

// ---------------------------------------------------------
// Banco de dados (IndexedDB via Dexie)
// ---------------------------------------------------------
const db = new Dexie("LexRevisaoDB");
db.version(1).stores({
  materias: "++id, nome",
  questoes: "++id, materiaId, tipo, assunto",
});
db.version(2).stores({
  projetos: "++id, nome",
  config: "chave",
});

// Em alguns navegadores/configurações (ex: abrir o arquivo direto do disco no
// Windows) o IndexedDB pode ficar bloqueado. Nesse caso o app cai para uma
// memória temporária, em vez de travar a tela toda.
let USANDO_FALLBACK = false;
let fallbackAutoId = 1;
const fallbackDB = { materias: [], questoes: [], projetos: [], config: {} };

const Store = {
  async contarMaterias() {
    return USANDO_FALLBACK ? fallbackDB.materias.length : db.materias.count();
  },
  async addMateria(nome) {
    if (USANDO_FALLBACK) {
      const id = fallbackAutoId++;
      fallbackDB.materias.push({ id, nome });
      agendarEnvioNuvem();
      return id;
    }
    const id = await db.materias.add({ nome });
    agendarEnvioNuvem();
    return id;
  },
  async addQuestao(obj) {
    if (USANDO_FALLBACK) {
      const id = fallbackAutoId++;
      fallbackDB.questoes.push({ ...obj, id });
      agendarEnvioNuvem();
      return id;
    }
    const id = await db.questoes.add(obj);
    agendarEnvioNuvem();
    return id;
  },
  async putQuestao(obj) {
    if (USANDO_FALLBACK) {
      const idx = fallbackDB.questoes.findIndex((q) => q.id === obj.id);
      if (idx >= 0) fallbackDB.questoes[idx] = obj;
      else fallbackDB.questoes.push(obj);
      agendarEnvioNuvem();
      return obj.id;
    }
    const r = await db.questoes.put(obj);
    agendarEnvioNuvem();
    return r;
  },
  async deleteQuestao(id) {
    if (USANDO_FALLBACK) {
      fallbackDB.questoes = fallbackDB.questoes.filter((q) => q.id !== id);
      agendarEnvioNuvem();
      return;
    }
    await db.questoes.delete(id);
    agendarEnvioNuvem();
  },
  async getAllMaterias() {
    return USANDO_FALLBACK ? [...fallbackDB.materias] : db.materias.toArray();
  },
  async getAllQuestoes() {
    return USANDO_FALLBACK ? [...fallbackDB.questoes] : db.questoes.toArray();
  },
  // Apaga tudo e recria as matérias a partir de uma lista [{nome}], devolvendo um mapa nome -> novoId
  async restaurarMaterias(materiasNovas) {
    const mapa = {};
    if (USANDO_FALLBACK) {
      fallbackDB.materias = [];
      fallbackDB.questoes = [];
      fallbackAutoId = 1;
      for (const m of materiasNovas) {
        const id = fallbackAutoId++;
        fallbackDB.materias.push({ id, nome: m.nome });
        mapa[m.nome] = id;
      }
    } else {
      await db.transaction("rw", db.materias, db.questoes, async () => {
        await db.materias.clear();
        await db.questoes.clear();
      });
      for (const m of materiasNovas) {
        const id = await db.materias.add({ nome: m.nome });
        mapa[m.nome] = id;
      }
    }
    return mapa;
  },

  // Projetos / concursos-alvo
  async addProjeto(nome, descricao) {
    const obj = { nome, descricao: descricao || "", icone: "🎯", ativo: true, materiasIds: [] };
    if (USANDO_FALLBACK) {
      const id = fallbackAutoId++;
      fallbackDB.projetos.push({ id, ...obj });
      agendarEnvioNuvem();
      return id;
    }
    const id = await db.projetos.add(obj);
    agendarEnvioNuvem();
    return id;
  },
  async atualizarProjeto(projeto) {
    if (USANDO_FALLBACK) {
      const idx = fallbackDB.projetos.findIndex((p) => p.id === projeto.id);
      if (idx >= 0) fallbackDB.projetos[idx] = projeto;
      agendarEnvioNuvem();
      return;
    }
    await db.projetos.put(projeto);
    agendarEnvioNuvem();
  },
  async getAllProjetos() {
    return USANDO_FALLBACK ? [...fallbackDB.projetos] : db.projetos.toArray();
  },
  async deleteProjeto(id) {
    if (USANDO_FALLBACK) {
      fallbackDB.projetos = fallbackDB.projetos.filter((p) => p.id !== id);
      agendarEnvioNuvem();
      return;
    }
    await db.projetos.delete(id);
    agendarEnvioNuvem();
  },

  // Aplica um "retrato" completo vindo da nuvem (substitui tudo, preservando os IDs originais
  // pra manter as referências entre questões/matérias/projetos intactas)
  async substituirTudoLocal(materiasNovas, questoesNovas, projetosNovas) {
    if (USANDO_FALLBACK) {
      fallbackDB.materias = materiasNovas;
      fallbackDB.questoes = questoesNovas;
      fallbackDB.projetos = projetosNovas;
      return;
    }
    await db.transaction("rw", db.materias, db.questoes, db.projetos, async () => {
      await db.materias.clear();
      await db.questoes.clear();
      await db.projetos.clear();
      if (materiasNovas.length) await db.materias.bulkAdd(materiasNovas);
      if (questoesNovas.length) await db.questoes.bulkAdd(questoesNovas);
      if (projetosNovas.length) await db.projetos.bulkAdd(projetosNovas);
    });
  },

  // Configurações simples (chave/valor) — ex: projeto ativo
  async getConfig(chave) {
    if (USANDO_FALLBACK) return fallbackDB.config[chave] ?? null;
    const row = await db.config.get(chave);
    return row ? row.valor : null;
  },
  async setConfig(chave, valor) {
    if (USANDO_FALLBACK) {
      fallbackDB.config[chave] = valor;
      return;
    }
    return db.config.put({ chave, valor });
  },
};

async function ativarModoFallbackSeNecessario() {
  try {
    await db.open();
  } catch (e) {
    console.warn("IndexedDB indisponível, usando memória temporária:", e);
    USANDO_FALLBACK = true;
  }
}

const MATERIAS_PADRAO = [
  "Direito Constitucional",
  "Direito Penal",
  "Processo Civil",
  "Processo Penal",
  "Normas da Corregedoria Geral da Justiça",
  "Estatuto das Pessoas com Deficiência",
  "Lei nº 9.099/1995 (Juizados Especiais)",
  "Lei nº 8.429/1992 (Improbidade Administrativa)",
  "Lei nº 10.261/1968 (Estatuto dos Servidores de SP)",
  "Atualidades",
  "Matemática",
  "Raciocínio Lógico",
  "Língua Portuguesa",
];

const QUESTOES_EXEMPLO = [
  {
    materiaNome: "Direito Penal",
    assunto: "Crimes contra a Administração Pública",
    tipo: "CE",
    enunciado: "Comete o crime de prevaricação o funcionário público que pratica ato de ofício para satisfazer interesse pessoal.",
    gabarito: true,
    justificativa: "Art. 319, CP: retardar ou deixar de praticar, indevidamente, ato de ofício, ou praticá-lo contra disposição expressa de lei, para satisfazer interesse ou sentimento pessoal.",
  },
  {
    materiaNome: "Direito Penal",
    assunto: "Crimes contra a Administração Pública",
    tipo: "CE",
    enunciado: "O crime de concussão exige que a vantagem indevida seja obtida mediante violência ou grave ameaça.",
    gabarito: false,
    justificativa: "Art. 316, CP: concussão é exigir vantagem indevida, para si ou para outrem, valendo-se da função — não exige violência ou grave ameaça (isso seria extorsão).",
  },
  {
    materiaNome: "Processo Civil",
    assunto: "Normas Fundamentais",
    tipo: "MC",
    enunciado: "Segundo o CPC, o processo deve ser resolvido, sempre que possível, de que forma?",
    alternativas: [
      { texto: "Apenas com decisão de mérito, ainda que sem cooperação das partes", correta: false },
      { texto: "Com a autocomposição das partes, inclusive no curso do processo", correta: true },
      { texto: "Exclusivamente por meio de sentença", correta: false },
      { texto: "Sem qualquer participação do juiz na fase de conhecimento", correta: false },
      { texto: "Somente por meio de recursos", correta: false },
    ],
    justificativa: "Art. 3º, §2º e §3º, CPC: o Estado promoverá, sempre que possível, a solução consensual dos conflitos; a conciliação, a mediação e outros métodos de solução consensual devem ser estimulados.",
  },
];

async function seedInicial() {
  const count = await Store.contarMaterias();
  if (count > 0) return;
  const idsPorNome = {};
  for (const nome of MATERIAS_PADRAO) {
    const id = await Store.addMateria(nome);
    idsPorNome[nome] = id;
  }
  for (const q of QUESTOES_EXEMPLO) {
    const materiaId = idsPorNome[q.materiaNome];
    await Store.addQuestao({
      materiaId,
      assunto: q.assunto,
      tipo: q.tipo,
      enunciado: q.enunciado,
      alternativas: q.alternativas || null,
      gabarito: q.tipo === "CE" ? q.gabarito : null,
      justificativa: q.justificativa,
      projetosIds: [],
      precisaRevisao: false,
      srs: novoSRS(),
    });
  }
}

// Cache em memória (carregado do IndexedDB; toda mutação também grava no banco)
let CACHE_MATERIAS = [];
let CACHE_QUESTOES = [];
let CACHE_PROJETOS = [];
let PROJETO_ATIVO_ID = null; // null = "todos os projetos" (sem filtro)

async function carregarTudo() {
  CACHE_MATERIAS = await Store.getAllMaterias();
  CACHE_QUESTOES = await Store.getAllQuestoes();
  CACHE_PROJETOS = await Store.getAllProjetos();
  const salvo = await Store.getConfig("projetoAtivoId");
  PROJETO_ATIVO_ID = salvo ? Number(salvo) : null;
}

function nomeProjeto(id) {
  const p = CACHE_PROJETOS.find((x) => x.id === id);
  return p ? p.nome : "—";
}

// Filtra uma lista de questões pelo projeto ativo (se houver). Questões sem
// nenhum projeto vinculado só aparecem quando NENHUM projeto está ativo.
function filtrarPorProjetoAtivo(lista) {
  if (!PROJETO_ATIVO_ID) return lista;
  return lista.filter((q) => Array.isArray(q.projetosIds) && q.projetosIds.includes(PROJETO_ATIVO_ID));
}

async function definirProjetoAtivo(id) {
  PROJETO_ATIVO_ID = id || null;
  await Store.setConfig("projetoAtivoId", PROJETO_ATIVO_ID || "");
}

function nomeMateria(materiaId) {
  const m = CACHE_MATERIAS.find((x) => x.id === materiaId);
  return m ? m.nome : "—";
}

// ---------------------------------------------------------
// Datas civis (YYYY-MM-DD) — sem depender de hora/minuto/fuso
// ---------------------------------------------------------
function hojeStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDiasStr(baseStr, dias) {
  const [y, m, d] = baseStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + dias);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
function formatarDataBR(str) {
  const [y, m, d] = str.split("-");
  return `${d}/${m}/${y}`;
}

// ---------------------------------------------------------
// SRS — repetição espaçada por data civil, teto de 20 dias
// ---------------------------------------------------------
const TETO_MAXIMO_DIAS = 20;

function novoSRS() {
  return { intervalo: 0, proximaRevisaoData: hojeStr(), acertosSeguidos: 0, historico: [] };
}

function atualizarSRS(srs, acertou) {
  const hoje = hojeStr();
  if (!acertou) {
    srs.acertosSeguidos = 0;
    srs.intervalo = 1;
  } else {
    srs.acertosSeguidos += 1;
    const tabela = { 1: 2, 2: 3, 3: 4, 4: 5 };
    if (srs.acertosSeguidos in tabela) {
      srs.intervalo = tabela[srs.acertosSeguidos];
    } else {
      srs.intervalo = Math.min(srs.intervalo + 2, TETO_MAXIMO_DIAS);
    }
  }
  srs.intervalo = Math.min(srs.intervalo, TETO_MAXIMO_DIAS);
  srs.proximaRevisaoData = addDiasStr(hoje, srs.intervalo);
  srs.historico.push({ data: hoje, acertou });
  return srs;
}

function estaPendenteHoje(q) {
  return q.srs.proximaRevisaoData <= hojeStr();
}

async function salvarQuestao(q) {
  await Store.putQuestao(q);
  const idx = CACHE_QUESTOES.findIndex((x) => x.id === q.id);
  if (idx >= 0) CACHE_QUESTOES[idx] = q;
  else CACHE_QUESTOES.push(q);
}

// ---------------------------------------------------------
// Motor de geração de pegadinhas (Certo/Errado a partir de texto colado)
// ---------------------------------------------------------
const AUTORIDADES = [
  "juiz", "oficial de justiça", "escrivão", "diretor de secretaria",
  "corregedor-geral da justiça", "presidente do tribunal", "desembargador",
  "promotor de justiça", "delegado de polícia", "tabelião",
];
const PARES_OPOSTOS = [
  ["vedado", "permitido"], ["proibido", "permitido"], ["proibida", "permitida"],
  ["obrigatório", "facultativo"], ["obrigatória", "facultativa"],
  ["deverá", "poderá"], ["deve", "pode"], ["deverão", "poderão"],
  ["antes", "depois"], ["anterior", "posterior"], ["maior", "menor"], ["superior", "inferior"],
];
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function gerarRegrasDisponiveis(texto) {
  const regras = [];
  const reprazo = /\b(\d+)\s*(dias?|meses?|anos?|horas?)\b/i;
  const mPrazo = texto.match(reprazo);
  if (mPrazo) {
    regras.push({ tipo: "prazo", aplicar(t) {
      const n = parseInt(mPrazo[1], 10);
      let novo = n + (n <= 5 ? n + 1 : Math.max(1, Math.round(n * 0.5)));
      if (novo === n) novo += 1;
      return { alterado: t.replace(reprazo, `${novo} ${mPrazo[2]}`), original: mPrazo[0], modificado: `${novo} ${mPrazo[2]}` };
    }});
  }
  const reConectivo = /\s(e|ou)\s/;
  const mConectivo = texto.match(reConectivo);
  if (mConectivo) {
    regras.push({ tipo: "conectivo", aplicar(t) {
      const trocado = mConectivo[1] === "e" ? "ou" : "e";
      return { alterado: t.replace(reConectivo, ` ${trocado} `), original: mConectivo[1], modificado: trocado };
    }});
  }
  const reRessalva = /\b(salvo|exceto)\b([^,.;]*)/i;
  const mRessalva = texto.match(reRessalva);
  if (mRessalva) {
    regras.push({ tipo: "ressalva", aplicar(t) {
      return { alterado: t.replace(reRessalva, "inclusive$2"), original: mRessalva[0].trim(), modificado: "(ressalva removida)" };
    }});
  }
  for (const [a, b] of PARES_OPOSTOS) {
    const re = new RegExp(`\\b${escapeRegExp(a)}\\b`, "i");
    const m = texto.match(re);
    if (m) {
      regras.push({ tipo: "oposto", aplicar(t) { return { alterado: t.replace(re, b), original: m[0], modificado: b }; } });
      break;
    }
  }
  const reAuto = new RegExp(`\\b(${AUTORIDADES.map(escapeRegExp).join("|")})\\b`, "i");
  const mAuto = texto.match(reAuto);
  if (mAuto) {
    const base = mAuto[0].toLowerCase();
    const alternativas = AUTORIDADES.filter((a) => a !== base);
    const escolhida = alternativas[Math.floor(Math.random() * alternativas.length)];
    regras.push({ tipo: "autoridade", aplicar(t) {
      return { alterado: t.replace(reAuto, escolhida), original: mAuto[0], modificado: escolhida };
    }});
  }
  return regras;
}
const LABEL_TIPO = {
  prazo: "prazo alterado", conectivo: "conectivo lógico trocado (e/ou)",
  ressalva: "ressalva (salvo/exceto) removida", oposto: "sentido invertido",
  autoridade: "autoridade competente trocada",
};

function gerarCandidatosCE(trecho) {
  const texto = trecho.trim();
  const candidatos = [{ enunciado: texto, correta: true, alteracao: null, selecionado: true }];
  const regras = gerarRegrasDisponiveis(texto).slice(0, 3);
  regras.forEach((regra) => {
    const { alterado, original, modificado } = regra.aplicar(texto);
    if (alterado === texto) return;
    candidatos.push({
      enunciado: alterado, correta: false,
      alteracao: { tipo: regra.tipo, original, modificado, label: LABEL_TIPO[regra.tipo] },
      selecionado: true,
    });
  });
  return candidatos;
}

// ---------------------------------------------------------
// Importação em massa (texto colado ou .txt)
// Certo/Errado:   Enunciado; C|E; Justificativa
// Múltipla (5):   Enunciado; Alt1; Alt2; Alt3; Alt4; Alt5; Gabarito(A-E); Justificativa
// ---------------------------------------------------------
function parseImportacao(raw, tipo) {
  const linhas = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const registros = [];
  const linhasComErro = [];

  linhas.forEach((linha, i) => {
    const partes = linha.split(/;|\t/).map((p) => p.trim());
    if (tipo === "CE") {
      if (partes.length < 3) { linhasComErro.push(i + 1); return; }
      const [enunciado, gab, ...resto] = partes;
      registros.push({
        tipo: "CE", enunciado,
        gabarito: /^c/i.test(gab),
        alternativas: null,
        justificativa: resto.join("; "),
      });
    } else {
      if (partes.length < 8) { linhasComErro.push(i + 1); return; }
      const [enunciado, a, b, c, d, e, gabLetra, ...resto] = partes;
      const letras = ["A", "B", "C", "D", "E"];
      const alvo = gabLetra.trim().toUpperCase();
      registros.push({
        tipo: "MC", enunciado,
        gabarito: null,
        alternativas: [a, b, c, d, e].map((texto, idx) => ({ texto, correta: letras[idx] === alvo })),
        justificativa: resto.join("; "),
      });
    }
  });
  return { registros, linhasComErro };
}

// ---------------------------------------------------------
// Auditor de legislação — similaridade de texto (Jaccard sobre palavras)
// Compara a justificativa/enunciado de cada questão com o texto atualizado
// da lei, para sinalizar possíveis desatualizações.
// ---------------------------------------------------------
function tokenizar(texto) {
  return (texto || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}
function similaridadeJaccard(a, b) {
  const tokensA = new Set(tokenizar(a));
  const tokensB = new Set(tokenizar(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersecao = 0;
  tokensA.forEach((t) => { if (tokensB.has(t)) intersecao++; });
  const uniao = new Set([...tokensA, ...tokensB]).size;
  return uniao === 0 ? 0 : intersecao / uniao;
}
function melhorTrechoSimilar(textoQuestao, textoLeiAtualizada) {
  const frases = textoLeiAtualizada
    .split(/(?<=[.;])\s+/)
    .map((f) => f.trim())
    .filter((f) => f.length > 8);
  let melhor = { frase: null, score: 0 };
  frases.forEach((f) => {
    const score = similaridadeJaccard(textoQuestao, f);
    if (score > melhor.score) melhor = { frase: f, score };
  });
  return melhor;
}

// ---------------------------------------------------------
// Estado de navegação
// ---------------------------------------------------------
let estado = { tela: "home" };
let sessaoAtual = null;
let candidatosPendentes = [];
let graficosAtivos = [];

function ir(tela, params = {}) {
  estado = { tela, ...params };
  renderizar();
}

function destruirGraficos() {
  graficosAtivos.forEach((g) => g.destroy());
  graficosAtivos = [];
}

// ---------------------------------------------------------
// Helpers de UI
// ---------------------------------------------------------
function criarEl(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
function cabecalho(titulo, subtitulo) {
  const wrap = criarEl("div", "flex items-center gap-3 mb-6");
  const btn = criarEl("button", "text-stone-400 hover:text-amber-400 text-xl leading-none px-1", "←");
  btn.addEventListener("click", () => ir("home"));
  wrap.appendChild(btn);
  const box = criarEl("div");
  box.appendChild(criarEl("h1", "font-serif text-xl text-stone-100 leading-tight", titulo));
  if (subtitulo) box.appendChild(criarEl("p", "text-sm text-stone-500 mt-0.5", subtitulo));
  wrap.appendChild(box);
  return wrap;
}
function campoInput(label, placeholder, value = "") {
  const wrap = criarEl("div");
  wrap.appendChild(criarEl("label", "block text-sm text-stone-400 mb-1.5", label));
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = placeholder;
  input.value = value;
  input.className = "w-full bg-stone-900 border border-stone-800 rounded-xl px-4 py-3 text-stone-100 placeholder-stone-600 outline-none focus:border-amber-500/60";
  wrap.appendChild(input);
  return { wrap, input };
}
function campoTextarea(label, placeholder, rows = 6) {
  const wrap = criarEl("div");
  wrap.appendChild(criarEl("label", "block text-sm text-stone-400 mb-1.5", label));
  const input = document.createElement("textarea");
  input.rows = rows;
  input.placeholder = placeholder;
  input.className = "w-full bg-stone-900 border border-stone-800 rounded-xl px-4 py-3 text-stone-100 placeholder-stone-600 outline-none focus:border-amber-500/60";
  wrap.appendChild(input);
  return { wrap, input };
}
function campoSelectMaterias(valorInicial) {
  const wrap = criarEl("div");
  const topLabel = criarEl("div", "flex items-center justify-between mb-1.5");
  topLabel.appendChild(criarEl("label", "text-sm text-stone-400", "Matéria"));
  const btnNova = criarEl("button", "text-xs text-amber-400", "+ Nova matéria");
  topLabel.appendChild(btnNova);
  wrap.appendChild(topLabel);

  const select = document.createElement("select");
  select.className = "w-full bg-stone-900 border border-stone-800 rounded-xl px-4 py-3 text-stone-100 outline-none focus:border-amber-500/60";
  function preencher() {
    select.innerHTML = "";
    CACHE_MATERIAS.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.nome;
      if (String(m.id) === String(valorInicial)) opt.selected = true;
      select.appendChild(opt);
    });
  }
  preencher();
  btnNova.addEventListener("click", async () => {
    const nome = prompt("Nome da nova matéria:");
    if (!nome || !nome.trim()) return;
    const id = await Store.addMateria(nome.trim());
    CACHE_MATERIAS.push({ id, nome: nome.trim() });
    preencher();
    select.value = id;
  });
  wrap.appendChild(select);
  return { wrap, select };
}
function alertaInline(container, msg) {
  const existente = container.querySelector(".alerta-inline");
  if (existente) existente.remove();
  container.appendChild(criarEl("p", "alerta-inline text-sm text-red-400 mt-1", msg));
}
function campoSelecaoProjetos() {
  const wrap = criarEl("div");
  if (CACHE_PROJETOS.length === 0) return { wrap, getSelecionados: () => [] };
  wrap.appendChild(criarEl("label", "block text-sm text-stone-400 mb-1.5", "Vincular a projetos/concursos (opcional)"));
  const lista = criarEl("div", "flex flex-wrap gap-2");
  const checkboxes = [];
  CACHE_PROJETOS.forEach((p) => {
    const id = `proj-${p.id}-${Math.random().toString(36).slice(2, 6)}`;
    const label = criarEl("label", "flex items-center gap-1.5 bg-stone-900 border border-stone-800 rounded-lg px-2.5 py-1.5 text-xs text-stone-300");
    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "accent-amber-500";
    check.checked = PROJETO_ATIVO_ID === p.id;
    check.dataset.projetoId = p.id;
    checkboxes.push(check);
    label.appendChild(check);
    label.appendChild(document.createTextNode(p.nome));
    lista.appendChild(label);
  });
  wrap.appendChild(lista);
  return {
    wrap,
    getSelecionados: () => checkboxes.filter((c) => c.checked).map((c) => Number(c.dataset.projetoId)),
  };
}
function statBox(label, valor) {
  const b = criarEl("div", "bg-stone-900/60 border border-stone-800 rounded-xl p-4");
  b.appendChild(criarEl("p", "text-2xl font-serif text-stone-100", valor));
  b.appendChild(criarEl("p", "text-xs text-stone-500 mt-1", label));
  return b;
}

// ---------------------------------------------------------
// Renderização
// ---------------------------------------------------------
function renderizar() {
  destruirGraficos();
  app.innerHTML = "";
  const telas = {
    home: telaHome,
    importar: telaImportar,
    manual: telaManual,
    materias: telaMaterias,
    sessao: telaSessao,
    resumoSessao: telaResumoSessao,
    estatisticas: telaEstatisticas,
    backup: telaBackup,
    gerenciar: telaGerenciar,
    auditor: telaAuditor,
    projetos: telaProjetos,
  };
  const fn = telas[estado.tela] || telaHome;
  app.appendChild(fn());
  window.scrollTo(0, 0);
}

// ---- HOME ----
function telaHome() {
  const questoesDoProjeto = filtrarPorProjetoAtivo(CACHE_QUESTOES);
  const pendentes = questoesDoProjeto.filter(estaPendenteHoje);
  const c = criarEl("div", "max-w-md mx-auto px-5 pt-8 pb-24");

  const brand = criarEl("div", "mb-4 flex items-center justify-between");
  const tit = criarEl("div");
  tit.appendChild(criarEl("p", "text-xs tracking-wide text-amber-500/80 mb-1", "Lex Revisão"));
  tit.appendChild(criarEl("h1", "font-serif text-2xl text-stone-100", "Bons estudos."));
  brand.appendChild(tit);
  const btnStats = criarEl("button", "text-stone-400 text-xs border border-stone-800 rounded-lg px-3 py-2", "📊 Estatísticas");
  btnStats.addEventListener("click", () => ir("estatisticas"));
  brand.appendChild(btnStats);
  c.appendChild(brand);

  // Seletor de projeto ativo (concurso-alvo)
  const wrapProjeto = criarEl("div", "flex items-center gap-2 mb-6");
  const selectProjeto = document.createElement("select");
  selectProjeto.className = "flex-1 bg-stone-900 border border-stone-800 rounded-lg px-3 py-2 text-sm text-stone-200 outline-none";
  const optTodos = document.createElement("option");
  optTodos.value = "";
  optTodos.textContent = "🎯 Todos os projetos";
  selectProjeto.appendChild(optTodos);
  CACHE_PROJETOS.filter((p) => p.ativo !== false).forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.icone || "🎯"} ${p.nome}`;
    if (PROJETO_ATIVO_ID === p.id) opt.selected = true;
    selectProjeto.appendChild(opt);
  });
  selectProjeto.addEventListener("change", async () => {
    await definirProjetoAtivo(selectProjeto.value ? Number(selectProjeto.value) : null);
    renderizar();
  });
  const btnNovoProjeto = criarEl("button", "text-xs text-amber-400 border border-amber-500/30 rounded-lg px-2 py-2 whitespace-nowrap", "+ Projeto");
  btnNovoProjeto.addEventListener("click", async () => {
    const nome = prompt("Nome do projeto/concurso (ex: TJ-SP Escrevente):");
    if (!nome || !nome.trim()) return;
    const id = await Store.addProjeto(nome.trim());
    await carregarTudo();
    await definirProjetoAtivo(id);
    renderizar();
  });
  const btnGerenciarProjetos = criarEl("button", "text-xs text-stone-400 border border-stone-800 rounded-lg px-2.5 py-2", "⚙️");
  btnGerenciarProjetos.title = "Gerenciar projetos";
  btnGerenciarProjetos.addEventListener("click", () => ir("projetos"));
  wrapProjeto.appendChild(selectProjeto);
  wrapProjeto.appendChild(btnNovoProjeto);
  wrapProjeto.appendChild(btnGerenciarProjetos);
  c.appendChild(wrapProjeto);

  if (USANDO_FALLBACK) {
    const aviso = criarEl(
      "div",
      "bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-6 text-xs text-amber-300 leading-relaxed",
      "Este navegador não permitiu salvar dados localmente abrindo o arquivo direto do disco. O app funciona, mas o que você cadastrar pode não ficar salvo ao fechar. Para salvar de verdade, hospede a pasta (ex: GitHub Pages) e acesse pelo link."
    );
    c.appendChild(aviso);
  }

  const cardPendentes = criarEl("button", "w-full text-left bg-stone-900 border border-stone-800 rounded-2xl p-5 mb-4 active:scale-[0.99] transition");
  cardPendentes.innerHTML = `
    <div class="flex items-center justify-between">
      <div>
        <p class="text-sm text-stone-400">Revisões pendentes de hoje</p>
        <p class="font-serif text-3xl text-amber-400 mt-1">${pendentes.length}</p>
      </div>
      <span class="text-amber-500/70 text-2xl">›</span>
    </div>`;
  if (pendentes.length === 0) cardPendentes.classList.add("opacity-50");
  else cardPendentes.addEventListener("click", () => iniciarSessao(pendentes.map((q) => q.id)));
  c.appendChild(cardPendentes);

  const cardMaterias = criarEl("button", "w-full text-left bg-stone-900 border border-stone-800 rounded-2xl p-5 mb-4 flex items-center justify-between");
  cardMaterias.innerHTML = `
    <div>
      <p class="text-sm text-stone-400">Treinar por matéria</p>
      <p class="text-stone-200 mt-1">${CACHE_MATERIAS.length} matérias cadastradas</p>
    </div>
    <span class="text-stone-500 text-2xl">›</span>`;
  cardMaterias.addEventListener("click", () => ir("materias"));
  c.appendChild(cardMaterias);

  const total = questoesDoProjeto.length;
  const acertosTotais = questoesDoProjeto.reduce((n, q) => n + q.srs.historico.filter((h) => h.acertou).length, 0);
  const tentativasTotais = questoesDoProjeto.reduce((n, q) => n + q.srs.historico.length, 0);
  const pct = tentativasTotais ? Math.round((acertosTotais / tentativasTotais) * 100) : null;
  const stats = criarEl("div", "grid grid-cols-2 gap-3 mb-8");
  stats.appendChild(statBox("Questões no banco", total.toString()));
  stats.appendChild(statBox("Aproveitamento geral", pct === null ? "—" : `${pct}%`));
  c.appendChild(stats);

  const acoes = criarEl("div", "space-y-3");
  const btnImportar = criarEl("button", "w-full bg-amber-500 text-stone-950 font-medium rounded-xl py-3.5 active:scale-[0.99] transition", "+ Importar questões em massa");
  btnImportar.addEventListener("click", () => ir("importar"));
  acoes.appendChild(btnImportar);

  const btnManual = criarEl("button", "w-full bg-stone-900 border border-stone-800 text-stone-300 rounded-xl py-3.5 active:scale-[0.99] transition", "Cadastrar questão manualmente");
  btnManual.addEventListener("click", () => ir("manual"));
  acoes.appendChild(btnManual);

  const linha2 = criarEl("div", "grid grid-cols-2 gap-3");
  const btnBackup = criarEl("button", "text-stone-400 text-sm py-2 border border-stone-800 rounded-lg", "🔄 Backup / Sincronizar");
  btnBackup.addEventListener("click", () => ir("backup"));
  const btnGerenciar = criarEl("button", "text-stone-400 text-sm py-2 border border-stone-800 rounded-lg", "🗂 Gerenciar banco");
  btnGerenciar.addEventListener("click", () => ir("gerenciar"));
  linha2.appendChild(btnBackup);
  linha2.appendChild(btnGerenciar);
  acoes.appendChild(linha2);

  const btnAuditor = criarEl("button", "w-full text-stone-400 text-sm py-2 border border-stone-800 rounded-lg", "⚖️ Auditor de legislação");
  btnAuditor.addEventListener("click", () => ir("auditor"));
  acoes.appendChild(btnAuditor);

  c.appendChild(acoes);
  return c;
}

// ---- IMPORTAÇÃO EM MASSA ----
function telaImportar() {
  const c = criarEl("div", "max-w-md mx-auto px-5 pt-8 pb-24");
  c.appendChild(cabecalho("Importar questões", "Cole o texto ou envie um arquivo .txt"));

  const form = criarEl("div", "space-y-4");
  const { wrap: wrapMateria, select: selectMateria } = campoSelectMaterias();
  form.appendChild(wrapMateria);

  const { wrap: wrapAssunto, input: inputAssunto } = campoInput("Assunto / subtópico", 'Ex: "Crimes contra a Administração — Art. 312 a 327"');
  form.appendChild(wrapAssunto);

  const { wrap: wrapProjetos, getSelecionados: getProjetosSelecionados } = campoSelecaoProjetos();
  form.appendChild(wrapProjetos);

  const wrapTipo = criarEl("div");
  wrapTipo.appendChild(criarEl("label", "block text-sm text-stone-400 mb-1.5", "Formato"));
  const toggleTipo = criarEl("div", "grid grid-cols-2 gap-2");
  let tipoSelecionado = "CE";
  const btnCE = criarEl("button", "rounded-xl py-3 text-sm bg-amber-500 text-stone-950 font-medium", "Certo/Errado");
  const btnMC = criarEl("button", "rounded-xl py-3 text-sm bg-stone-800 text-stone-400", "Múltipla escolha (5)");
  function atualizarToggle() {
    btnCE.className = `rounded-xl py-3 text-sm ${tipoSelecionado === "CE" ? "bg-amber-500 text-stone-950 font-medium" : "bg-stone-800 text-stone-400"}`;
    btnMC.className = `rounded-xl py-3 text-sm ${tipoSelecionado === "MC" ? "bg-amber-500 text-stone-950 font-medium" : "bg-stone-800 text-stone-400"}`;
  }
  btnCE.addEventListener("click", () => { tipoSelecionado = "CE"; atualizarToggle(); atualizarExemplo(); });
  btnMC.addEventListener("click", () => { tipoSelecionado = "MC"; atualizarToggle(); atualizarExemplo(); });
  toggleTipo.appendChild(btnCE);
  toggleTipo.appendChild(btnMC);
  wrapTipo.appendChild(toggleTipo);
  form.appendChild(wrapTipo);

  const exemploFormato = criarEl("p", "text-xs text-stone-500 leading-relaxed");
  function atualizarExemplo() {
    exemploFormato.textContent =
      tipoSelecionado === "CE"
        ? "Formato: Enunciado; C ou E; Justificativa/artigo — uma questão por linha."
        : "Formato: Enunciado; Alt.A; Alt.B; Alt.C; Alt.D; Alt.E; Gabarito (A-E); Justificativa — uma questão por linha.";
  }
  atualizarExemplo();
  form.appendChild(exemploFormato);

  const { wrap: wrapTexto, input: textareaTexto } = campoTextarea("Colar texto", "Cole aqui as questões, uma por linha...", 8);
  form.appendChild(wrapTexto);

  const wrapArquivo = criarEl("div");
  wrapArquivo.appendChild(criarEl("label", "block text-sm text-stone-400 mb-1.5", "Ou envie um arquivo .txt"));
  const inputArquivo = document.createElement("input");
  inputArquivo.type = "file";
  inputArquivo.accept = ".txt";
  inputArquivo.className = "w-full text-sm text-stone-400";
  inputArquivo.addEventListener("change", () => {
    const file = inputArquivo.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { textareaTexto.value = reader.result; };
    reader.readAsText(file, "UTF-8");
  });
  wrapArquivo.appendChild(inputArquivo);
  form.appendChild(wrapArquivo);

  const btnPreview = criarEl("button", "w-full bg-amber-500 text-stone-950 font-medium rounded-xl py-3.5 mt-2", "Pré-visualizar importação");
  const areaPreview = criarEl("div", "mt-4");
  btnPreview.addEventListener("click", () => {
    areaPreview.innerHTML = "";
    const raw = textareaTexto.value.trim();
    const assunto = inputAssunto.value.trim();
    if (!raw || !assunto) { alertaInline(form, "Preencha o assunto e cole o texto (ou envie o arquivo) antes de importar."); return; }
    const { registros, linhasComErro } = parseImportacao(raw, tipoSelecionado);

    const resumo = criarEl("div", "bg-stone-900 border border-stone-800 rounded-xl p-4 mb-3");
    resumo.appendChild(criarEl("p", "text-stone-200", `${registros.length} questão(ões) reconhecida(s).`));
    if (linhasComErro.length) {
      resumo.appendChild(criarEl("p", "text-xs text-red-400 mt-1", `Linha(s) com formato inválido, ignoradas: ${linhasComErro.join(", ")}`));
    }
    areaPreview.appendChild(resumo);

    if (registros.length > 0) {
      const btnConfirmar = criarEl("button", "w-full bg-emerald-500 text-stone-950 font-medium rounded-xl py-3.5", `Confirmar e salvar ${registros.length} questão(ões)`);
      btnConfirmar.addEventListener("click", async () => {
        const materiaId = Number(selectMateria.value);
        const projetosIds = getProjetosSelecionados();
        for (const r of registros) {
          await Store.addQuestao({
            materiaId, assunto, tipo: r.tipo,
            enunciado: r.enunciado,
            alternativas: r.alternativas,
            gabarito: r.gabarito,
            justificativa: r.justificativa,
            projetosIds,
            precisaRevisao: false,
            srs: novoSRS(),
          });
        }
        await carregarTudo();
        ir("home");
      });
      areaPreview.appendChild(btnConfirmar);
    }
  });

  form.appendChild(btnPreview);
  form.appendChild(areaPreview);
  c.appendChild(form);
  return c;
}

// ---- CADASTRO MANUAL ----
function telaManual() {
  const c = criarEl("div", "max-w-md mx-auto px-5 pt-8 pb-24");
  c.appendChild(cabecalho("Cadastrar manualmente"));

  const form = criarEl("div", "space-y-4");
  const { wrap: wrapMateria, select: selectMateria } = campoSelectMaterias();
  form.appendChild(wrapMateria);
  const { wrap: wrapAssunto, input: inputAssunto } = campoInput("Assunto / subtópico", "Ex: Direitos e Garantias Fundamentais — Art. 5º");
  form.appendChild(wrapAssunto);

  let tipoSelecionado = "CE";
  const wrapTipo = criarEl("div");
  wrapTipo.appendChild(criarEl("label", "block text-sm text-stone-400 mb-1.5", "Formato"));
  const toggleTipo = criarEl("div", "grid grid-cols-2 gap-2 mb-4");
  const btnCE = criarEl("button", "rounded-xl py-3 text-sm bg-amber-500 text-stone-950 font-medium", "Certo/Errado");
  const btnMC = criarEl("button", "rounded-xl py-3 text-sm bg-stone-800 text-stone-400", "Múltipla escolha (5)");
  toggleTipo.appendChild(btnCE);
  toggleTipo.appendChild(btnMC);
  wrapTipo.appendChild(toggleTipo);
  form.appendChild(wrapTipo);

  const { wrap: wrapEnunciado, input: inputEnunciado } = campoTextarea("Enunciado", "Digite a afirmação ou pergunta...", 4);
  form.appendChild(wrapEnunciado);

  const areaCE = criarEl("div", "space-y-3");
  let gabaritoCE = true;
  const toggleGab = criarEl("div", "grid grid-cols-2 gap-2");
  const gCerto = criarEl("button", "rounded-xl py-3 bg-emerald-500 text-stone-950 font-medium", "Certo");
  const gErrado = criarEl("button", "rounded-xl py-3 bg-stone-800 text-stone-400", "Errado");
  gCerto.addEventListener("click", () => { gabaritoCE = true; gCerto.className = "rounded-xl py-3 bg-emerald-500 text-stone-950 font-medium"; gErrado.className = "rounded-xl py-3 bg-stone-800 text-stone-400"; });
  gErrado.addEventListener("click", () => { gabaritoCE = false; gErrado.className = "rounded-xl py-3 bg-red-500 text-stone-950 font-medium"; gCerto.className = "rounded-xl py-3 bg-stone-800 text-stone-400"; });
  toggleGab.appendChild(gCerto);
  toggleGab.appendChild(gErrado);
  areaCE.appendChild(toggleGab);

  const areaMC = criarEl("div", "space-y-2 hidden");
  const inputsAlternativas = [];
  ["A", "B", "C", "D", "E"].forEach((letra) => {
    const { wrap, input } = campoInput(`Alternativa ${letra}`, `Texto da alternativa ${letra}`);
    inputsAlternativas.push(input);
    areaMC.appendChild(wrap);
  });
  const wrapGabMC = criarEl("div");
  wrapGabMC.appendChild(criarEl("label", "block text-sm text-stone-400 mb-1.5 mt-2", "Gabarito"));
  const selectGabMC = document.createElement("select");
  selectGabMC.className = "w-full bg-stone-900 border border-stone-800 rounded-xl px-4 py-3 text-stone-100";
  ["A", "B", "C", "D", "E"].forEach((l) => {
    const opt = document.createElement("option");
    opt.value = l; opt.textContent = l;
    selectGabMC.appendChild(opt);
  });
  wrapGabMC.appendChild(selectGabMC);
  areaMC.appendChild(wrapGabMC);

  form.appendChild(areaCE);
  form.appendChild(areaMC);

  btnCE.addEventListener("click", () => {
    tipoSelecionado = "CE";
    btnCE.className = "rounded-xl py-3 text-sm bg-amber-500 text-stone-950 font-medium";
    btnMC.className = "rounded-xl py-3 text-sm bg-stone-800 text-stone-400";
    areaCE.classList.remove("hidden"); areaMC.classList.add("hidden");
  });
  btnMC.addEventListener("click", () => {
    tipoSelecionado = "MC";
    btnMC.className = "rounded-xl py-3 text-sm bg-amber-500 text-stone-950 font-medium";
    btnCE.className = "rounded-xl py-3 text-sm bg-stone-800 text-stone-400";
    areaMC.classList.remove("hidden"); areaCE.classList.add("hidden");
  });

  const { wrap: wrapJustificativa, input: inputJustificativa } = campoTextarea("Justificativa / trecho da lei", "Cole o trecho exato da lei...", 3);
  form.appendChild(wrapJustificativa);

  const { wrap: wrapProjetos, getSelecionados: getProjetosSelecionados } = campoSelecaoProjetos();
  form.appendChild(wrapProjetos);

  const btnSalvar = criarEl("button", "w-full bg-amber-500 text-stone-950 font-medium rounded-xl py-3.5 mt-2", "Salvar questão");
  btnSalvar.addEventListener("click", async () => {
    const materiaId = Number(selectMateria.value);
    const assunto = inputAssunto.value.trim();
    const enunciado = inputEnunciado.value.trim();
    if (!assunto || !enunciado) { alertaInline(form, "Preencha ao menos o assunto e o enunciado."); return; }

    let payload = {
      materiaId, assunto, tipo: tipoSelecionado, enunciado,
      justificativa: inputJustificativa.value.trim(),
      projetosIds: getProjetosSelecionados(),
      precisaRevisao: false,
      srs: novoSRS(),
    };
    if (tipoSelecionado === "CE") {
      payload.gabarito = gabaritoCE;
      payload.alternativas = null;
    } else {
      const textos = inputsAlternativas.map((i) => i.value.trim());
      if (textos.some((t) => !t)) { alertaInline(form, "Preencha as 5 alternativas."); return; }
      const letra = selectGabMC.value;
      const letras = ["A", "B", "C", "D", "E"];
      payload.alternativas = textos.map((texto, idx) => ({ texto, correta: letras[idx] === letra }));
      payload.gabarito = null;
    }
    await Store.addQuestao(payload);
    await carregarTudo();
    ir("home");
  });
  form.appendChild(btnSalvar);

  c.appendChild(form);
  return c;
}

// ---- MATÉRIAS ----
function telaMaterias() {
  const c = criarEl("div", "max-w-md mx-auto px-5 pt-8 pb-24");
  c.appendChild(cabecalho("Treinar por matéria", PROJETO_ATIVO_ID ? `Filtrando pelo projeto: ${nomeProjeto(PROJETO_ATIVO_ID)}` : null));

  const questoesDoProjeto = filtrarPorProjetoAtivo(CACHE_QUESTOES);
  const lista = criarEl("div", "space-y-3");
  CACHE_MATERIAS.forEach((m) => {
    const qs = questoesDoProjeto.filter((q) => q.materiaId === m.id);
    const pendentes = qs.filter(estaPendenteHoje).length;
    const card = criarEl("button", "w-full text-left bg-stone-900 border border-stone-800 rounded-xl p-4 flex items-center justify-between");
    card.innerHTML = `
      <div>
        <p class="text-stone-100">${m.nome}</p>
        <p class="text-xs text-stone-500 mt-0.5">${qs.length} questão(ões) · ${pendentes} pendente(s) hoje</p>
      </div>
      <span class="text-stone-500 text-xl">›</span>`;
    if (qs.length === 0) card.classList.add("opacity-50");
    else card.addEventListener("click", () => iniciarSessao(qs.map((q) => q.id)));
    lista.appendChild(card);
  });
  c.appendChild(lista);
  return c;
}

// ---- SESSÃO DE TREINO ----
function iniciarSessao(ids) {
  const embaralhado = [...ids].sort(() => Math.random() - 0.5);
  sessaoAtual = { fila: embaralhado, pos: 0, acertos: 0, total: embaralhado.length, respondida: false, alternativasEmbaralhadas: null };
  ir("sessao");
}

function telaSessao() {
  if (!sessaoAtual || sessaoAtual.pos >= sessaoAtual.fila.length) return telaResumoSessao();
  const qid = sessaoAtual.fila[sessaoAtual.pos];
  const questao = CACHE_QUESTOES.find((q) => q.id === qid);

  const c = criarEl("div", "max-w-md mx-auto px-5 pt-8 pb-10 min-h-screen flex flex-col");
  const topo = criarEl("div", "flex items-center justify-between mb-6");
  const fechar = criarEl("button", "text-stone-500 text-xl", "×");
  fechar.addEventListener("click", () => { sessaoAtual = null; ir("home"); });
  topo.appendChild(fechar);
  topo.appendChild(criarEl("p", "text-xs text-stone-500", `${sessaoAtual.pos + 1} / ${sessaoAtual.total}`));
  topo.appendChild(criarEl("span", "w-5"));
  c.appendChild(topo);

  const barra = criarEl("div", "w-full h-1 bg-stone-800 rounded-full mb-8");
  const progresso = criarEl("div", "h-1 bg-amber-500 rounded-full transition-all");
  progresso.style.width = `${(sessaoAtual.pos / sessaoAtual.total) * 100}%`;
  barra.appendChild(progresso);
  c.appendChild(barra);

  c.appendChild(criarEl("p", "text-xs text-amber-500/80 mb-1", nomeMateria(questao.materiaId)));
  c.appendChild(criarEl("p", "text-xs text-stone-600 mb-3", questao.assunto || ""));

  const cardQuestao = criarEl("div", "bg-stone-900 border border-stone-800 rounded-2xl p-5 mb-6");
  cardQuestao.appendChild(criarEl("p", "font-serif text-lg text-stone-100 leading-relaxed", questao.enunciado));
  c.appendChild(cardQuestao);

  const areaResposta = criarEl("div", "space-y-3 flex-1");

  if (questao.tipo === "CE") {
    if (!sessaoAtual.respondida) {
      const botoes = criarEl("div", "grid grid-cols-2 gap-3");
      const btnCerto = criarEl("button", "bg-emerald-500 text-stone-950 font-medium rounded-xl py-4 active:scale-[0.98] transition", "Certo");
      const btnErrado = criarEl("button", "bg-red-500 text-stone-950 font-medium rounded-xl py-4 active:scale-[0.98] transition", "Errado");
      btnCerto.addEventListener("click", () => responderCE(questao, true));
      btnErrado.addEventListener("click", () => responderCE(questao, false));
      botoes.appendChild(btnCerto);
      botoes.appendChild(btnErrado);
      areaResposta.appendChild(botoes);
    } else {
      areaResposta.appendChild(painelFeedbackCE(questao));
    }
  } else {
    if (!sessaoAtual.alternativasEmbaralhadas) {
      sessaoAtual.alternativasEmbaralhadas = [...questao.alternativas].sort(() => Math.random() - 0.5);
    }
    if (!sessaoAtual.respondida) {
      const lista = criarEl("div", "space-y-2");
      sessaoAtual.alternativasEmbaralhadas.forEach((alt) => {
        const btn = criarEl("button", "w-full text-left bg-stone-900 border border-stone-800 rounded-xl px-4 py-3 text-stone-200 active:scale-[0.99] transition", alt.texto);
        btn.addEventListener("click", () => responderMC(questao, alt));
        lista.appendChild(btn);
      });
      areaResposta.appendChild(lista);
    } else {
      areaResposta.appendChild(painelFeedbackMC(questao));
    }
  }

  c.appendChild(areaResposta);
  return c;
}

async function responderCE(questao, respostaUsuario) {
  const acertou = respostaUsuario === questao.gabarito;
  atualizarSRS(questao.srs, acertou);
  await salvarQuestao(questao);
  if (acertou) sessaoAtual.acertos += 1;
  sessaoAtual.respondida = true;
  sessaoAtual.ultimaResposta = { acertou, respostaUsuario };
  renderizar();
}
async function responderMC(questao, altEscolhida) {
  const acertou = !!altEscolhida.correta;
  atualizarSRS(questao.srs, acertou);
  await salvarQuestao(questao);
  if (acertou) sessaoAtual.acertos += 1;
  sessaoAtual.respondida = true;
  sessaoAtual.ultimaResposta = { acertou, altEscolhida };
  renderizar();
}

function painelFeedbackCE(questao) {
  const { acertou } = sessaoAtual.ultimaResposta;
  const wrap = criarEl("div");
  const banner = criarEl("div", `rounded-xl p-4 mb-4 ${acertou ? "bg-emerald-500/10 border border-emerald-500/30" : "bg-red-500/10 border border-red-500/30"}`);
  banner.appendChild(criarEl("p", `font-medium ${acertou ? "text-emerald-400" : "text-red-400"}`, acertou ? "Você acertou." : "Você errou."));
  banner.appendChild(criarEl("p", "text-sm text-stone-400 mt-1", `Gabarito: ${questao.gabarito ? "Certo" : "Errado"}.`));
  wrap.appendChild(banner);
  wrap.appendChild(painelJustificativa(questao));
  wrap.appendChild(btnProximaSessao());
  return wrap;
}
function painelFeedbackMC(questao) {
  const { acertou, altEscolhida } = sessaoAtual.ultimaResposta;
  const wrap = criarEl("div");
  const lista = criarEl("div", "space-y-2 mb-4");
  sessaoAtual.alternativasEmbaralhadas.forEach((alt) => {
    let classe = "bg-stone-900 border border-stone-800 text-stone-400";
    if (alt.correta) classe = "bg-emerald-500/15 border border-emerald-500/40 text-emerald-300";
    else if (alt === altEscolhida) classe = "bg-red-500/15 border border-red-500/40 text-red-300";
    lista.appendChild(criarEl("div", `w-full text-left rounded-xl px-4 py-3 ${classe}`, alt.texto));
  });
  wrap.appendChild(lista);
  const banner = criarEl("p", `font-medium mb-3 ${acertou ? "text-emerald-400" : "text-red-400"}`, acertou ? "Você acertou." : "Você errou.");
  wrap.appendChild(banner);
  wrap.appendChild(painelJustificativa(questao));
  wrap.appendChild(btnProximaSessao());
  return wrap;
}
function painelJustificativa(questao) {
  const justif = criarEl("div", "bg-stone-900 border border-stone-800 rounded-xl p-4 mb-4");
  justif.appendChild(criarEl("p", "text-xs text-stone-500 mb-1.5", "Justificativa / trecho da lei"));
  justif.appendChild(criarEl("p", "font-serif text-stone-200 leading-relaxed", questao.justificativa || "—"));
  const prox = criarEl("p", "text-xs text-stone-500 mt-3", `Próxima revisão: ${formatarDataBR(questao.srs.proximaRevisaoData)}`);
  justif.appendChild(prox);
  return justif;
}
function btnProximaSessao() {
  const btn = criarEl("button", "w-full bg-amber-500 text-stone-950 font-medium rounded-xl py-3.5", "Próxima");
  btn.addEventListener("click", () => {
    sessaoAtual.pos += 1;
    sessaoAtual.respondida = false;
    sessaoAtual.ultimaResposta = null;
    sessaoAtual.alternativasEmbaralhadas = null;
    renderizar();
  });
  return btn;
}

function telaResumoSessao() {
  const c = criarEl("div", "max-w-md mx-auto px-5 pt-16 pb-24 text-center");
  const pct = sessaoAtual.total ? Math.round((sessaoAtual.acertos / sessaoAtual.total) * 100) : 0;
  c.appendChild(criarEl("p", "text-xs text-amber-500/80 mb-2", "Sessão concluída"));
  c.appendChild(criarEl("p", "font-serif text-4xl text-stone-100 mb-1", `${pct}%`));
  c.appendChild(criarEl("p", "text-stone-500 text-sm mb-10", `${sessaoAtual.acertos} de ${sessaoAtual.total} questões corretas`));
  const btn = criarEl("button", "w-full bg-amber-500 text-stone-950 font-medium rounded-xl py-3.5", "Voltar ao início");
  btn.addEventListener("click", () => { sessaoAtual = null; ir("home"); });
  c.appendChild(btn);
  return c;
}

// ---- ESTATÍSTICAS ----
// ---- ESTATÍSTICAS ----
function historicoNoPeriodo(q, dataIni, dataFim) {
  return (q.srs.historico || []).filter(
    (h) => (!dataIni || h.data >= dataIni) && (!dataFim || h.data <= dataFim)
  );
}

function calcularArvoreEstatisticas(dataIni, dataFim) {
  const questoesBase = filtrarPorProjetoAtivo(CACHE_QUESTOES);
  const porMateria = {};
  questoesBase.forEach((q) => {
    if (!porMateria[q.materiaId]) {
      porMateria[q.materiaId] = { assuntos: {}, resolvidas: 0, acertos: 0 };
    }
    const m = porMateria[q.materiaId];
    const chaveAssunto = q.assunto || "(sem assunto)";
    if (!m.assuntos[chaveAssunto]) {
      m.assuntos[chaveAssunto] = { resolvidas: 0, acertos: 0, idsQuestoes: [] };
    }
    const a = m.assuntos[chaveAssunto];
    a.idsQuestoes.push(q.id);
    const hist = historicoNoPeriodo(q, dataIni, dataFim);
    hist.forEach((h) => {
      a.resolvidas++;
      m.resolvidas++;
      if (h.acertou) { a.acertos++; m.acertos++; }
    });
  });
  return porMateria;
}

function telaEstatisticas() {
  const c = criarEl("div", "max-w-md mx-auto px-5 pt-8 pb-24");
  c.appendChild(cabecalho("Estatísticas", PROJETO_ATIVO_ID ? `Projeto: ${nomeProjeto(PROJETO_ATIVO_ID)}` : "Todos os projetos"));

  // --- Estado local desta tela (mantido enquanto ela está aberta) ---
  const st = {
    dataIni: null,
    dataFim: null,
    ordenacao: "indice", // indice | crescente | decrescente
    mostrarGrafico: true,
    mostrarTexto: true,
    expandido: new Set(),
    selecionados: new Set(), // chaves "materiaId|assunto"
  };

  // --- Barra de filtro de período ---
  const barraFiltro = criarEl("div", "bg-stone-900 border border-stone-800 rounded-2xl p-4 mb-4");
  const linhaDatas = criarEl("div", "flex items-center gap-2 mb-3");
  const inputIni = document.createElement("input");
  inputIni.type = "date";
  inputIni.className = "flex-1 bg-stone-950 border border-stone-800 rounded-lg px-2 py-2 text-xs text-stone-200";
  const inputFim = document.createElement("input");
  inputFim.type = "date";
  inputFim.className = "flex-1 bg-stone-950 border border-stone-800 rounded-lg px-2 py-2 text-xs text-stone-200";
  linhaDatas.appendChild(inputIni);
  linhaDatas.appendChild(criarEl("span", "text-stone-600 text-xs", "até"));
  linhaDatas.appendChild(inputFim);
  barraFiltro.appendChild(linhaDatas);

  const atalhos = criarEl("div", "grid grid-cols-4 gap-1.5 mb-3");
  function botaoAtalho(label, fn) {
    const b = criarEl("button", "text-xs bg-stone-800 text-stone-300 rounded-lg py-1.5", label);
    b.addEventListener("click", () => { fn(); atualizarTudo(); });
    return b;
  }
  atalhos.appendChild(botaoAtalho("Hoje", () => { st.dataIni = hojeStr(); st.dataFim = hojeStr(); }));
  atalhos.appendChild(botaoAtalho("7 dias", () => { st.dataIni = addDiasStr(hojeStr(), -7); st.dataFim = hojeStr(); }));
  atalhos.appendChild(botaoAtalho("Este mês", () => { st.dataIni = hojeStr().slice(0, 8) + "01"; st.dataFim = hojeStr(); }));
  atalhos.appendChild(botaoAtalho("Tudo", () => { st.dataIni = null; st.dataFim = null; }));
  barraFiltro.appendChild(atalhos);

  const btnFiltrar = criarEl("button", "w-full bg-amber-500 text-stone-950 font-medium rounded-lg py-2 text-sm", "Filtrar");
  btnFiltrar.addEventListener("click", () => {
    st.dataIni = inputIni.value || null;
    st.dataFim = inputFim.value || null;
    atualizarTudo();
  });
  barraFiltro.appendChild(btnFiltrar);
  c.appendChild(barraFiltro);

  // --- Cards de resumo + gráfico donut ---
  const areaResumo = criarEl("div");
  c.appendChild(areaResumo);

  // --- Opções de exibição da árvore ---
  const barraOpcoes = criarEl("div", "flex items-center justify-between mt-5 mb-2");
  const wrapOrdenacao = document.createElement("select");
  wrapOrdenacao.className = "bg-stone-900 border border-stone-800 rounded-lg px-2 py-1.5 text-xs text-stone-300";
  [["indice", "Índice (edital)"], ["decrescente", "Pior desempenho primeiro"], ["crescente", "Melhor desempenho primeiro"]].forEach(([v, label]) => {
    const opt = document.createElement("option");
    opt.value = v; opt.textContent = label;
    wrapOrdenacao.appendChild(opt);
  });
  wrapOrdenacao.addEventListener("change", () => { st.ordenacao = wrapOrdenacao.value; renderArvore(); });
  barraOpcoes.appendChild(wrapOrdenacao);

  const wrapToggles = criarEl("div", "flex items-center gap-3 text-xs text-stone-400");
  const labelGrafico = criarEl("label", "flex items-center gap-1");
  const checkGrafico = document.createElement("input");
  checkGrafico.type = "checkbox"; checkGrafico.checked = true; checkGrafico.className = "accent-amber-500";
  checkGrafico.addEventListener("change", () => { st.mostrarGrafico = checkGrafico.checked; renderArvore(); });
  labelGrafico.appendChild(checkGrafico); labelGrafico.appendChild(document.createTextNode("Gráfico"));
  const labelTexto = criarEl("label", "flex items-center gap-1");
  const checkTexto = document.createElement("input");
  checkTexto.type = "checkbox"; checkTexto.checked = true; checkTexto.className = "accent-amber-500";
  checkTexto.addEventListener("change", () => { st.mostrarTexto = checkTexto.checked; renderArvore(); });
  labelTexto.appendChild(checkTexto); labelTexto.appendChild(document.createTextNode("Números"));
  wrapToggles.appendChild(labelGrafico);
  wrapToggles.appendChild(labelTexto);
  barraOpcoes.appendChild(wrapToggles);
  c.appendChild(barraOpcoes);

  const linhaSelecionarTodos = criarEl("label", "flex items-center gap-2 text-xs text-stone-400 mb-2");
  const checkTodos = document.createElement("input");
  checkTodos.type = "checkbox";
  checkTodos.className = "accent-amber-500";
  linhaSelecionarTodos.appendChild(checkTodos);
  linhaSelecionarTodos.appendChild(document.createTextNode("Selecionar todos"));
  c.appendChild(linhaSelecionarTodos);

  // --- Árvore de matérias/assuntos ---
  const areaArvore = criarEl("div", "space-y-2 mb-4");
  c.appendChild(areaArvore);

  // --- Rodapé com totais da seleção e ações ---
  const rodape = criarEl("div", "bg-stone-900 border border-stone-800 rounded-2xl p-4 mt-4");
  const linhaTotais = criarEl("p", "text-xs text-stone-400 mb-3");
  rodape.appendChild(linhaTotais);
  const linhaBotoes = criarEl("div", "grid grid-cols-1 gap-2");
  const btnCriarCaderno = criarEl("button", "w-full bg-amber-500 text-stone-950 font-medium rounded-xl py-3 text-sm", "Criar caderno com seleção");
  const btnExportar = criarEl("button", "w-full bg-stone-800 text-stone-300 rounded-xl py-2.5 text-sm", "Exportar dados (CSV)");
  linhaBotoes.appendChild(btnCriarCaderno);
  linhaBotoes.appendChild(btnExportar);
  rodape.appendChild(linhaBotoes);
  c.appendChild(rodape);

  let arvoreAtual = {};

  function atualizarTudo() {
    arvoreAtual = calcularArvoreEstatisticas(st.dataIni, st.dataFim);
    renderResumo();
    renderArvore();
  }

  function renderResumo() {
    areaResumo.innerHTML = "";
    let totalResolvidas = 0;
    const materiasComResolucao = [];
    Object.entries(arvoreAtual).forEach(([materiaId, m]) => {
      totalResolvidas += m.resolvidas;
      if (m.resolvidas > 0) materiasComResolucao.push({ id: Number(materiaId), nome: nomeMateria(Number(materiaId)), resolvidas: m.resolvidas });
    });

    const cards = criarEl("div", "grid grid-cols-2 gap-3 mb-4");
    cards.appendChild(statBox("Questões resolvidas", totalResolvidas.toString()));
    cards.appendChild(statBox("Matérias estudadas", materiasComResolucao.length.toString()));
    areaResumo.appendChild(cards);

    if (materiasComResolucao.length === 0) {
      areaResumo.appendChild(criarEl("p", "text-stone-500 text-sm", "Nenhuma questão resolvida no período selecionado."));
      return;
    }

    const wrapDonut = criarEl("div", "bg-stone-900 border border-stone-800 rounded-2xl p-4 flex items-center gap-4");
    const canvasDonut = document.createElement("canvas");
    canvasDonut.style.maxWidth = "140px";
    canvasDonut.style.maxHeight = "140px";
    const wrapCanvas = criarEl("div", "flex-shrink-0");
    wrapCanvas.style.width = "140px";
    wrapCanvas.style.height = "140px";
    wrapCanvas.appendChild(canvasDonut);
    wrapDonut.appendChild(wrapCanvas);

    const cores = ["#C9A24B", "#4ADE80", "#60A5FA", "#F472B6", "#FB923C", "#A78BFA", "#34D399", "#F87171", "#38BDF8", "#FACC15", "#FB7185", "#818CF8", "#2DD4BF"];
    const legenda = criarEl("div", "flex-1 space-y-1");
    materiasComResolucao.forEach((m, i) => {
      const linha = criarEl("div", "flex items-center gap-1.5 text-xs text-stone-300");
      linha.innerHTML = `<span style="width:8px;height:8px;border-radius:2px;background:${cores[i % cores.length]};display:inline-block;"></span><span class="truncate">${m.nome}</span><span class="text-stone-500 ml-auto">${m.resolvidas}</span>`;
      legenda.appendChild(linha);
    });
    wrapDonut.appendChild(legenda);
    areaResumo.appendChild(wrapDonut);

    const chart = new Chart(canvasDonut, {
      type: "doughnut",
      data: {
        labels: materiasComResolucao.map((m) => m.nome),
        datasets: [{ data: materiasComResolucao.map((m) => m.resolvidas), backgroundColor: materiasComResolucao.map((_, i) => cores[i % cores.length]), borderWidth: 0 }],
      },
      options: { plugins: { legend: { display: false } }, cutout: "65%" },
    });
    graficosAtivos.push(chart);
  }

  function linhasOrdenadas(entradas, chavePct) {
    if (st.ordenacao === "crescente") return [...entradas].sort((a, b) => chavePct(a) - chavePct(b));
    if (st.ordenacao === "decrescente") return [...entradas].sort((a, b) => chavePct(b) - chavePct(a));
    return entradas; // índice = ordem original
  }

  function renderArvore() {
    areaArvore.innerHTML = "";
    const materiasOrdenadas = linhasOrdenadas(
      CACHE_MATERIAS.filter((m) => arvoreAtual[m.id]),
      (m) => {
        const d = arvoreAtual[m.id];
        return d.resolvidas ? (d.acertos / d.resolvidas) * 100 : -1;
      }
    );

    if (materiasOrdenadas.length === 0) {
      areaArvore.appendChild(criarEl("p", "text-stone-500 text-sm", "Nenhum dado para exibir com os filtros atuais."));
      atualizarRodape();
      return;
    }

    materiasOrdenadas.forEach((materia) => {
      const dadosMateria = arvoreAtual[materia.id];
      const pctMateria = dadosMateria.resolvidas ? Math.round((dadosMateria.acertos / dadosMateria.resolvidas) * 100) : null;
      const assuntosEntradas = Object.entries(dadosMateria.assuntos);
      const assuntosOrdenados = linhasOrdenadas(assuntosEntradas, ([, a]) => (a.resolvidas ? (a.acertos / a.resolvidas) * 100 : -1));
      const todosAssuntosSelecionados = assuntosEntradas.every(([assunto]) => st.selecionados.has(`${materia.id}|${assunto}`));

      const card = criarEl("div", "bg-stone-900 border border-stone-800 rounded-xl overflow-hidden");

      const cabecaMateria = criarEl("div", "flex items-center gap-2 p-3 cursor-pointer");
      const checkMateria = document.createElement("input");
      checkMateria.type = "checkbox";
      checkMateria.className = "accent-amber-500 flex-shrink-0";
      checkMateria.checked = todosAssuntosSelecionados;
      checkMateria.addEventListener("click", (e) => e.stopPropagation());
      checkMateria.addEventListener("change", () => {
        assuntosEntradas.forEach(([assunto]) => {
          const chave = `${materia.id}|${assunto}`;
          if (checkMateria.checked) st.selecionados.add(chave); else st.selecionados.delete(chave);
        });
        renderArvore();
      });
      cabecaMateria.appendChild(checkMateria);

      const seta = criarEl("span", "text-stone-500 text-xs flex-shrink-0", st.expandido.has(materia.id) ? "▼" : "▶");
      cabecaMateria.appendChild(seta);

      const infoMateria = criarEl("div", "flex-1 min-w-0");
      infoMateria.appendChild(criarEl("p", "text-sm text-stone-100 truncate", materia.nome));
      cabecaMateria.appendChild(infoMateria);

      if (st.mostrarTexto) {
        cabecaMateria.appendChild(criarEl("span", "text-xs text-stone-500 flex-shrink-0", `${dadosMateria.resolvidas}`));
      }
      if (pctMateria !== null) {
        const corPct = pctMateria >= 70 ? "text-emerald-400" : pctMateria >= 40 ? "text-amber-400" : "text-red-400";
        cabecaMateria.appendChild(criarEl("span", `text-xs font-medium flex-shrink-0 w-10 text-right ${corPct}`, `${pctMateria}%`));
      } else {
        cabecaMateria.appendChild(criarEl("span", "text-xs text-stone-600 flex-shrink-0 w-10 text-right", "—"));
      }
      cabecaMateria.addEventListener("click", () => {
        if (st.expandido.has(materia.id)) st.expandido.delete(materia.id); else st.expandido.add(materia.id);
        renderArvore();
      });
      card.appendChild(cabecaMateria);

      if (st.mostrarGrafico && dadosMateria.resolvidas > 0) {
        const barraWrap = criarEl("div", "px-3 pb-2");
        const barraFundo = criarEl("div", "w-full h-1.5 bg-stone-800 rounded-full overflow-hidden");
        const barraPreenchida = criarEl("div", `h-full ${pctMateria >= 70 ? "bg-emerald-500" : pctMateria >= 40 ? "bg-amber-500" : "bg-red-500"}`);
        barraPreenchida.style.width = `${pctMateria}%`;
        barraFundo.appendChild(barraPreenchida);
        barraWrap.appendChild(barraFundo);
        card.appendChild(barraWrap);
      }

      if (st.expandido.has(materia.id)) {
        const listaAssuntos = criarEl("div", "border-t border-stone-800 divide-y divide-stone-800");
        assuntosOrdenados.forEach(([assunto, dadosAssunto]) => {
          const pctAssunto = dadosAssunto.resolvidas ? Math.round((dadosAssunto.acertos / dadosAssunto.resolvidas) * 100) : null;
          const chave = `${materia.id}|${assunto}`;
          const linha = criarEl("div", "flex items-center gap-2 p-3 pl-8");
          const checkAssunto = document.createElement("input");
          checkAssunto.type = "checkbox";
          checkAssunto.className = "accent-amber-500 flex-shrink-0";
          checkAssunto.checked = st.selecionados.has(chave);
          checkAssunto.addEventListener("change", () => {
            if (checkAssunto.checked) st.selecionados.add(chave); else st.selecionados.delete(chave);
            renderArvore();
          });
          linha.appendChild(checkAssunto);
          linha.appendChild(criarEl("p", "flex-1 min-w-0 text-xs text-stone-300 truncate", assunto));
          if (st.mostrarTexto) linha.appendChild(criarEl("span", "text-xs text-stone-500 flex-shrink-0", `${dadosAssunto.resolvidas}`));
          if (pctAssunto !== null) {
            const corA = pctAssunto >= 70 ? "text-emerald-400" : pctAssunto >= 40 ? "text-amber-400" : "text-red-400";
            linha.appendChild(criarEl("span", `text-xs font-medium flex-shrink-0 w-10 text-right ${corA}`, `${pctAssunto}%`));
          } else {
            linha.appendChild(criarEl("span", "text-xs text-stone-600 flex-shrink-0 w-10 text-right", "—"));
          }
          listaAssuntos.appendChild(linha);
        });
        card.appendChild(listaAssuntos);
      }

      areaArvore.appendChild(card);
    });

    checkTodos.checked = [...st.selecionados].length > 0 && CACHE_MATERIAS.every((m) => {
      const d = arvoreAtual[m.id];
      if (!d) return true;
      return Object.keys(d.assuntos).every((assunto) => st.selecionados.has(`${m.id}|${assunto}`));
    });

    atualizarRodape();
  }

  function atualizarRodape() {
    let resolvidas = 0, acertos = 0;
    st.selecionados.forEach((chave) => {
      const [materiaId, assunto] = chave.split("|");
      const d = arvoreAtual[Number(materiaId)];
      const a = d && d.assuntos[assunto];
      if (a) { resolvidas += a.resolvidas; acertos += a.acertos; }
    });
    const erros = resolvidas - acertos;
    const pct = resolvidas ? Math.round((acertos / resolvidas) * 100) : 0;
    linhaTotais.textContent = `Seleção → Resolvidas: ${resolvidas} · Acertos: ${acertos} · Erros: ${erros} · Aproveitamento: ${resolvidas ? pct + "%" : "—"}`;
    const semSelecao = st.selecionados.size === 0;
    btnCriarCaderno.disabled = semSelecao;
    btnCriarCaderno.classList.toggle("opacity-50", semSelecao);
  }

  checkTodos.addEventListener("change", () => {
    if (checkTodos.checked) {
      Object.entries(arvoreAtual).forEach(([materiaId, m]) => {
        Object.keys(m.assuntos).forEach((assunto) => st.selecionados.add(`${materiaId}|${assunto}`));
      });
    } else {
      st.selecionados.clear();
    }
    renderArvore();
  });

  btnCriarCaderno.addEventListener("click", () => {
    const idsQuestoes = new Set();
    st.selecionados.forEach((chave) => {
      const [materiaId, assunto] = chave.split("|");
      const d = arvoreAtual[Number(materiaId)];
      const a = d && d.assuntos[assunto];
      if (a) a.idsQuestoes.forEach((id) => idsQuestoes.add(id));
    });
    if (idsQuestoes.size === 0) return;
    iniciarSessao([...idsQuestoes]);
  });

  btnExportar.addEventListener("click", () => {
    const linhas = [["Matéria", "Assunto", "Resolvidas", "Acertos", "Erros", "Aproveitamento (%)"]];
    Object.entries(arvoreAtual).forEach(([materiaId, m]) => {
      Object.entries(m.assuntos).forEach(([assunto, a]) => {
        const pct = a.resolvidas ? Math.round((a.acertos / a.resolvidas) * 100) : "";
        linhas.push([nomeMateria(Number(materiaId)), assunto, a.resolvidas, a.acertos, a.resolvidas - a.acertos, pct]);
      });
    });
    const csv = linhas.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `estatisticas-${hojeStr()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  atualizarTudo();
  return c;
}

// ---- BACKUP / RESTAURAR ----
function telaBackup() {
  const c = criarEl("div", "max-w-md mx-auto px-5 pt-8 pb-24");
  c.appendChild(cabecalho("Backup e sincronização"));

  // --- Sincronização automática (Google/Firebase) ---
  const secNuvem = criarEl("div", "bg-stone-900 border border-stone-800 rounded-2xl p-4 mb-6");
  secNuvem.appendChild(criarEl("p", "text-stone-200 mb-1", "☁️ Sincronização automática"));

  if (!firebaseAuth) {
    secNuvem.appendChild(criarEl("p", "text-xs text-stone-500", "Não foi possível carregar a sincronização (verifique sua internet e recarregue a página)."));
  } else if (usuarioLogado) {
    secNuvem.appendChild(criarEl("p", "text-xs text-emerald-400 mb-3", `Conectado como ${usuarioLogado.email}. Os dados sincronizam sozinhos entre seus aparelhos quando há internet.`));
    const btnSair = criarEl("button", "w-full bg-stone-800 text-stone-300 rounded-xl py-2.5 text-sm", "Sair / desconectar este aparelho");
    btnSair.addEventListener("click", async () => { await sairDaConta(); renderizar(); });
    secNuvem.appendChild(btnSair);
  } else {
    secNuvem.appendChild(criarEl("p", "text-xs text-stone-500 mb-3", "Entre com sua conta Google para sincronizar automaticamente entre o PC e o celular, sem precisar copiar nada. Faça isso nos dois aparelhos, com a mesma conta."));
    const btnEntrar = criarEl("button", "w-full bg-amber-500 text-stone-950 font-medium rounded-xl py-3 flex items-center justify-center gap-2", "Entrar com Google");
    btnEntrar.addEventListener("click", async () => {
      btnEntrar.disabled = true;
      btnEntrar.textContent = "Conectando...";
      const r = await entrarComGoogle();
      if (r.erro) {
        alertaInline(secNuvem, r.erro);
        btnEntrar.disabled = false;
        btnEntrar.textContent = "Entrar com Google";
      } else {
        renderizar();
      }
    });
    secNuvem.appendChild(btnEntrar);
  }
  c.appendChild(secNuvem);

  c.appendChild(criarEl("p", "text-xs text-stone-600 mb-2", "Ou, se preferir fazer manualmente (não precisa de conta):"));

  const secExport = criarEl("div", "bg-stone-900 border border-stone-800 rounded-2xl p-4 mb-6");
  secExport.appendChild(criarEl("p", "text-stone-200 mb-1", "Gerar backup"));
  secExport.appendChild(criarEl("p", "text-xs text-stone-500 mb-3", "Copie o código abaixo ou baixe o arquivo e leve para o outro aparelho."));
  const btnGerar = criarEl("button", "w-full bg-amber-500 text-stone-950 font-medium rounded-xl py-3 mb-3", "Gerar backup agora");
  const areaCodigo = criarEl("div");
  btnGerar.addEventListener("click", () => {
    const dados = JSON.stringify({ materias: CACHE_MATERIAS, questoes: CACHE_QUESTOES }, null, 0);
    areaCodigo.innerHTML = "";
    const textarea = document.createElement("textarea");
    textarea.readOnly = true;
    textarea.value = dados;
    textarea.rows = 6;
    textarea.className = "w-full bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 text-xs text-stone-400 outline-none";
    areaCodigo.appendChild(textarea);

    const linhaBotoes = criarEl("div", "grid grid-cols-2 gap-2 mt-2");
    const btnCopiar = criarEl("button", "bg-stone-800 text-stone-200 rounded-lg py-2 text-sm", "Copiar código");
    btnCopiar.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(dados); btnCopiar.textContent = "Copiado!"; }
      catch (e) { textarea.select(); document.execCommand("copy"); btnCopiar.textContent = "Copiado!"; }
      setTimeout(() => (btnCopiar.textContent = "Copiar código"), 1500);
    });
    const btnBaixar = criarEl("button", "bg-stone-800 text-stone-200 rounded-lg py-2 text-sm", "Baixar arquivo");
    btnBaixar.addEventListener("click", () => {
      const blob = new Blob([dados], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lex-revisao-backup-${hojeStr()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
    linhaBotoes.appendChild(btnCopiar);
    linhaBotoes.appendChild(btnBaixar);
    areaCodigo.appendChild(linhaBotoes);
  });
  secExport.appendChild(btnGerar);
  secExport.appendChild(areaCodigo);
  c.appendChild(secExport);

  const secImport = criarEl("div", "bg-stone-900 border border-stone-800 rounded-2xl p-4");
  secImport.appendChild(criarEl("p", "text-stone-200 mb-1", "Restaurar backup"));
  secImport.appendChild(criarEl("p", "text-xs text-amber-400/90 mb-3", "Atenção: isso substitui todos os dados deste aparelho pelos dados do backup."));
  const textareaImport = document.createElement("textarea");
  textareaImport.rows = 5;
  textareaImport.placeholder = "Cole aqui o código do backup...";
  textareaImport.className = "w-full bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 text-xs text-stone-300 outline-none mb-2";
  secImport.appendChild(textareaImport);

  const inputArquivoImport = document.createElement("input");
  inputArquivoImport.type = "file";
  inputArquivoImport.accept = ".json,.txt";
  inputArquivoImport.className = "w-full text-xs text-stone-400 mb-3";
  inputArquivoImport.addEventListener("change", () => {
    const file = inputArquivoImport.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { textareaImport.value = reader.result; };
    reader.readAsText(file, "UTF-8");
  });
  secImport.appendChild(inputArquivoImport);

  const btnRestaurar = criarEl("button", "w-full bg-red-500/90 text-stone-950 font-medium rounded-xl py-3", "Restaurar e substituir dados");
  btnRestaurar.addEventListener("click", async () => {
    let dados;
    try { dados = JSON.parse(textareaImport.value.trim()); }
    catch (e) { alertaInline(secImport, "Código inválido. Confira se colou o texto completo."); return; }
    if (!dados.materias || !dados.questoes) { alertaInline(secImport, "Arquivo não parece ser um backup válido."); return; }
    if (!confirm("Isso vai apagar os dados atuais deste aparelho e colocar os dados do backup. Continuar?")) return;

    const nomesAntigos = {};
    dados.materias.forEach((m) => (nomesAntigos[m.id] = m.nome));
    const mapaPorNome = await Store.restaurarMaterias(dados.materias);
    const primeiroId = Object.values(mapaPorNome)[0];
    for (const q of dados.questoes) {
      const nomeMat = nomesAntigos[q.materiaId];
      const novoMateriaId = mapaPorNome[nomeMat] ?? primeiroId;
      await Store.addQuestao({ ...q, id: undefined, materiaId: novoMateriaId });
    }
    await carregarTudo();
    ir("home");
  });
  secImport.appendChild(btnRestaurar);
  c.appendChild(secImport);

  return c;
}

// ---- GERENCIAR ----
// ---- AUDITOR DE LEGISLAÇÃO ----
function telaAuditor() {
  const c = criarEl("div", "max-w-md mx-auto px-5 pt-8 pb-24");
  c.appendChild(cabecalho("Auditor de legislação", "Cole a redação atualizada de uma lei e veja quais questões podem ter ficado desatualizadas"));

  const form = criarEl("div", "space-y-4");
  const { wrap: wrapMateria, select: selectMateria } = campoSelectMaterias();
  form.appendChild(wrapMateria);

  const { wrap: wrapAssunto, input: inputAssunto } = campoInput("Filtrar por assunto (opcional)", "Ex: Crimes contra a Administração");
  form.appendChild(wrapAssunto);

  const { wrap: wrapTexto, input: textareaTexto } = campoTextarea("Texto atualizado da lei", "Cole aqui a redação nova do artigo/lei...", 8);
  form.appendChild(wrapTexto);

  const btnRodar = criarEl("button", "w-full bg-amber-500 text-stone-950 font-medium rounded-xl py-3.5", "Rodar auditoria");
  const areaResultado = criarEl("div", "mt-5 space-y-3");

  btnRodar.addEventListener("click", () => {
    areaResultado.innerHTML = "";
    const textoLei = textareaTexto.value.trim();
    if (!textoLei) { alertaInline(form, "Cole o texto atualizado da lei antes de rodar."); return; }
    const materiaId = Number(selectMateria.value);
    const filtroAssunto = inputAssunto.value.trim().toLowerCase();

    const candidatas = CACHE_QUESTOES.filter((q) => {
      if (q.materiaId !== materiaId) return false;
      if (filtroAssunto && !(q.assunto || "").toLowerCase().includes(filtroAssunto)) return false;
      return true;
    });

    if (candidatas.length === 0) {
      areaResultado.appendChild(criarEl("p", "text-stone-500 text-sm", "Nenhuma questão cadastrada nessa matéria/assunto para comparar."));
      return;
    }

    const resultados = candidatas.map((q) => {
      const base = q.justificativa || q.enunciado;
      const { frase, score } = melhorTrechoSimilar(base, textoLei);
      return { q, frase, score };
    });
    resultados.sort((a, b) => a.score - b.score);

    const flagradas = resultados.filter((r) => r.score < 0.35);
    const resumo = criarEl("div", "bg-stone-900 border border-stone-800 rounded-xl p-4 mb-2");
    resumo.appendChild(criarEl("p", "text-stone-200", `${candidatas.length} questão(ões) analisada(s).`));
    resumo.appendChild(criarEl("p", `text-sm mt-1 ${flagradas.length ? "text-amber-400" : "text-emerald-400"}`, flagradas.length ? `${flagradas.length} possível(is) desatualização(ões) encontrada(s).` : "Nenhuma divergência significativa encontrada."));
    areaResultado.appendChild(resumo);

    resultados.forEach(({ q, frase, score }) => {
      const flagrada = score < 0.35;
      if (!flagrada) return; // mostra só as suspeitas, pra não poluir
      const card = criarEl("div", "bg-red-500/5 border border-red-500/30 rounded-xl p-4");
      card.appendChild(criarEl("span", "text-xs bg-red-500/15 text-red-400 rounded-full px-2 py-0.5", "⚠️ Possível Desatualização"));
      card.appendChild(criarEl("p", "text-sm text-stone-300 font-serif leading-relaxed mt-2", q.enunciado));
      card.appendChild(criarEl("p", "text-xs text-stone-500 mt-2", `Justificativa atual: "${q.justificativa || "—"}"`));
      card.appendChild(criarEl("p", "text-xs text-stone-500 mt-1", frase ? `Trecho mais parecido no texto novo (${Math.round(score * 100)}% similar): "${frase}"` : "Nenhum trecho parecido encontrado no texto colado — o artigo pode ter sido revogado."));
      const btnMarcar = criarEl("button", "text-xs text-amber-400 mt-2", q.precisaRevisao ? "✓ já marcada para revisar" : "Marcar para revisar");
      if (!q.precisaRevisao) {
        btnMarcar.addEventListener("click", async () => {
          q.precisaRevisao = true;
          await salvarQuestao(q);
          btnMarcar.textContent = "✓ já marcada para revisar";
        });
      }
      card.appendChild(document.createElement("br"));
      card.appendChild(btnMarcar);
      areaResultado.appendChild(card);
    });
  });

  form.appendChild(btnRodar);
  c.appendChild(form);
  c.appendChild(areaResultado);
  return c;
}

// ---- GERENCIAR PROJETOS (editar, arquivar, vincular matérias/questões) ----
function telaProjetos() {
  const c = criarEl("div", "max-w-md mx-auto px-5 pt-8 pb-24");
  c.appendChild(cabecalho("Gerenciar projetos", "Renomeie, arquive ou vincule matérias e questões"));

  if (CACHE_PROJETOS.length === 0) {
    c.appendChild(criarEl("p", "text-stone-500 text-sm", "Nenhum projeto criado ainda. Volte à tela inicial e use \"+ Projeto\"."));
    return c;
  }

  const lista = criarEl("div", "space-y-3");
  CACHE_PROJETOS.forEach((p) => {
    const qsDoProjeto = CACHE_QUESTOES.filter((q) => Array.isArray(q.projetosIds) && q.projetosIds.includes(p.id));
    const card = criarEl("div", "bg-stone-900 border border-stone-800 rounded-xl p-4");

    const topo = criarEl("div", "flex items-center justify-between mb-1");
    const titulo = criarEl("div", "flex items-center gap-2");
    titulo.appendChild(criarEl("span", "text-lg", p.icone || "🎯"));
    titulo.appendChild(criarEl("span", "text-stone-100", p.nome));
    if (p.ativo === false) titulo.appendChild(criarEl("span", "text-xs bg-stone-800 text-stone-500 rounded-full px-2 py-0.5", "arquivado"));
    topo.appendChild(titulo);
    const btnEditar = criarEl("button", "text-xs text-amber-400/90", "✏️ Editar");
    topo.appendChild(btnEditar);
    card.appendChild(topo);

    card.appendChild(criarEl("p", "text-xs text-stone-500", `${(p.materiasIds || []).length} matéria(s) vinculada(s) · ${qsDoProjeto.length} questão(ões)`));
    if (p.descricao) card.appendChild(criarEl("p", "text-xs text-stone-600 mt-1", p.descricao));

    const areaEdicao = criarEl("div", "mt-3 hidden border-t border-stone-800 pt-3");
    let montado = false;
    btnEditar.addEventListener("click", () => {
      const abrindo = areaEdicao.classList.contains("hidden");
      areaEdicao.classList.toggle("hidden");
      if (abrindo && !montado) { montarEdicaoProjeto(p, areaEdicao); montado = true; }
      btnEditar.textContent = abrindo ? "Fechar" : "✏️ Editar";
    });
    card.appendChild(areaEdicao);

    lista.appendChild(card);
  });
  c.appendChild(lista);
  return c;
}

function montarEdicaoProjeto(p, container) {
  const { wrap: wrapNome, input: inputNome } = campoInput("Nome do projeto", "");
  inputNome.value = p.nome;
  container.appendChild(wrapNome);

  const { wrap: wrapDescricao, input: inputDescricao } = campoInput("Descrição (opcional)", "Ex: Edital 2026, banca VUNESP");
  inputDescricao.value = p.descricao || "";
  container.appendChild(wrapDescricao);

  const { wrap: wrapIcone, input: inputIcone } = campoInput("Ícone (um emoji)", "🎯");
  inputIcone.value = p.icone || "🎯";
  container.appendChild(wrapIcone);

  const wrapStatus = criarEl("div", "mt-2");
  wrapStatus.appendChild(criarEl("label", "block text-sm text-stone-400 mb-1.5", "Status"));
  const toggleStatus = criarEl("div", "grid grid-cols-2 gap-2");
  let ativo = p.ativo !== false;
  const bAtivo = criarEl("button", `rounded-lg py-2 text-sm ${ativo ? "bg-emerald-500 text-stone-950" : "bg-stone-800 text-stone-400"}`, "Ativo");
  const bArquivado = criarEl("button", `rounded-lg py-2 text-sm ${!ativo ? "bg-stone-700 text-stone-200" : "bg-stone-800 text-stone-400"}`, "Arquivado");
  bAtivo.addEventListener("click", () => { ativo = true; bAtivo.className = "rounded-lg py-2 text-sm bg-emerald-500 text-stone-950"; bArquivado.className = "rounded-lg py-2 text-sm bg-stone-800 text-stone-400"; });
  bArquivado.addEventListener("click", () => { ativo = false; bArquivado.className = "rounded-lg py-2 text-sm bg-stone-700 text-stone-200"; bAtivo.className = "rounded-lg py-2 text-sm bg-stone-800 text-stone-400"; });
  toggleStatus.appendChild(bAtivo);
  toggleStatus.appendChild(bArquivado);
  wrapStatus.appendChild(toggleStatus);
  container.appendChild(wrapStatus);

  // Matérias vinculadas
  const wrapMaterias = criarEl("div", "mt-3");
  wrapMaterias.appendChild(criarEl("label", "block text-sm text-stone-400 mb-1.5", "Matérias deste projeto"));
  const listaMaterias = criarEl("div", "flex flex-wrap gap-2");
  const checksMaterias = [];
  const materiasSelecionadas = new Set(p.materiasIds || []);
  CACHE_MATERIAS.forEach((m) => {
    const label = criarEl("label", "flex items-center gap-1.5 bg-stone-950 border border-stone-800 rounded-lg px-2.5 py-1.5 text-xs text-stone-300");
    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "accent-amber-500";
    check.checked = materiasSelecionadas.has(m.id);
    check.dataset.materiaId = m.id;
    checksMaterias.push(check);
    label.appendChild(check);
    label.appendChild(document.createTextNode(m.nome));
    listaMaterias.appendChild(label);
  });
  wrapMaterias.appendChild(listaMaterias);
  container.appendChild(wrapMaterias);

  // Questões vinculadas em massa (limitado às matérias marcadas acima, ou todas se nenhuma marcada)
  const wrapQuestoes = criarEl("div", "mt-3");
  wrapQuestoes.appendChild(criarEl("label", "block text-sm text-stone-400 mb-1.5", "Questões vinculadas a este projeto"));
  const listaQuestoes = criarEl("div", "space-y-1.5 max-h-64 overflow-y-auto");
  const checksQuestoes = [];
  function renderListaQuestoes() {
    listaQuestoes.innerHTML = "";
    checksQuestoes.length = 0;
    const materiasFiltro = [...checksMaterias.filter((c) => c.checked).map((c) => Number(c.dataset.materiaId))];
    const candidatas = materiasFiltro.length
      ? CACHE_QUESTOES.filter((q) => materiasFiltro.includes(q.materiaId))
      : CACHE_QUESTOES;
    if (candidatas.length === 0) {
      listaQuestoes.appendChild(criarEl("p", "text-xs text-stone-600", "Nenhuma questão nas matérias selecionadas."));
      return;
    }
    candidatas.forEach((q) => {
      const label = criarEl("label", "flex items-start gap-2 bg-stone-950 border border-stone-800 rounded-lg px-2.5 py-1.5 text-xs text-stone-300");
      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "accent-amber-500 mt-0.5";
      check.checked = Array.isArray(q.projetosIds) && q.projetosIds.includes(p.id);
      check.dataset.questaoId = q.id;
      checksQuestoes.push(check);
      label.appendChild(check);
      label.appendChild(criarEl("span", "", `${nomeMateria(q.materiaId)} — ${q.enunciado.slice(0, 70)}${q.enunciado.length > 70 ? "…" : ""}`));
      listaQuestoes.appendChild(label);
    });
  }
  renderListaQuestoes();
  checksMaterias.forEach((c) => c.addEventListener("change", renderListaQuestoes));
  wrapQuestoes.appendChild(listaQuestoes);
  container.appendChild(wrapQuestoes);

  // Ações
  const btnSalvar = criarEl("button", "w-full bg-amber-500 text-stone-950 font-medium rounded-lg py-2.5 text-sm mt-3", "Salvar alterações");
  btnSalvar.addEventListener("click", async () => {
    p.nome = inputNome.value.trim() || p.nome;
    p.descricao = inputDescricao.value.trim();
    p.icone = inputIcone.value.trim() || "🎯";
    p.ativo = ativo;
    p.materiasIds = checksMaterias.filter((c) => c.checked).map((c) => Number(c.dataset.materiaId));
    await Store.atualizarProjeto(p);

    // aplica as marcações de questões em massa
    for (const check of checksQuestoes) {
      const qid = Number(check.dataset.questaoId);
      const q = CACHE_QUESTOES.find((x) => x.id === qid);
      if (!q) continue;
      const jaTinha = Array.isArray(q.projetosIds) && q.projetosIds.includes(p.id);
      if (check.checked && !jaTinha) {
        q.projetosIds = [...(q.projetosIds || []), p.id];
        await salvarQuestao(q);
      } else if (!check.checked && jaTinha) {
        q.projetosIds = q.projetosIds.filter((id) => id !== p.id);
        await salvarQuestao(q);
      }
    }
    await carregarTudo();
    renderizar();
  });
  container.appendChild(btnSalvar);

  const btnExcluir = criarEl("button", "w-full text-red-400/80 text-xs mt-3", "Excluir projeto (mantém as questões no banco)");
  btnExcluir.addEventListener("click", async () => {
    if (!confirm(`Excluir o projeto "${p.nome}"? As questões continuam no banco, só deixam de estar vinculadas a ele.`)) return;
    for (const q of CACHE_QUESTOES) {
      if (Array.isArray(q.projetosIds) && q.projetosIds.includes(p.id)) {
        q.projetosIds = q.projetosIds.filter((id) => id !== p.id);
        await salvarQuestao(q);
      }
    }
    await Store.deleteProjeto(p.id);
    if (PROJETO_ATIVO_ID === p.id) await definirProjetoAtivo(null);
    await carregarTudo();
    ir("projetos");
  });
  container.appendChild(btnExcluir);
}

function telaGerenciar() {
  const c = criarEl("div", "max-w-md mx-auto px-5 pt-8 pb-24");
  c.appendChild(cabecalho("Gerenciar banco de questões"));

  if (CACHE_QUESTOES.length === 0) {
    c.appendChild(criarEl("p", "text-stone-500 text-sm", "Nenhuma questão cadastrada ainda."));
    return c;
  }

  const lista = criarEl("div", "space-y-3");
  [...CACHE_QUESTOES].reverse().forEach((q) => {
    const card = criarEl("div", "bg-stone-900 border border-stone-800 rounded-xl p-4");
    const topo = criarEl("div", "flex items-center justify-between mb-2");
    const tags = criarEl("div", "flex items-center gap-2 flex-wrap");
    tags.appendChild(criarEl("span", "text-xs text-amber-500/80", `${nomeMateria(q.materiaId)} · ${q.tipo}`));
    if (q.precisaRevisao) tags.appendChild(criarEl("span", "text-xs bg-red-500/15 text-red-400 rounded-full px-2 py-0.5", "🚩 revisar"));
    if (Array.isArray(q.projetosIds) && q.projetosIds.length > 0) {
      q.projetosIds.forEach((pid) => tags.appendChild(criarEl("span", "text-xs bg-stone-800 text-stone-400 rounded-full px-2 py-0.5", nomeProjeto(pid))));
    }
    topo.appendChild(tags);

    const acoes = criarEl("div", "flex items-center gap-3 flex-shrink-0");
    const btnEditar = criarEl("button", "text-xs text-amber-400/90", "Editar");
    const btnExcluir = criarEl("button", "text-xs text-red-400/80", "Excluir");
    btnExcluir.addEventListener("click", async () => {
      await Store.deleteQuestao(q.id);
      await carregarTudo();
      renderizar();
    });
    acoes.appendChild(btnEditar);
    acoes.appendChild(btnExcluir);
    topo.appendChild(acoes);
    card.appendChild(topo);

    const corpo = criarEl("div");
    corpo.appendChild(criarEl("p", "text-sm text-stone-300 font-serif leading-relaxed mb-1", q.enunciado));
    corpo.appendChild(criarEl("p", "text-xs text-stone-600", `Acertos seguidos: ${q.srs.acertosSeguidos} · Próxima: ${formatarDataBR(q.srs.proximaRevisaoData)}`));
    card.appendChild(corpo);

    const areaEdicao = criarEl("div", "mt-3 hidden space-y-2 border-t border-stone-800 pt-3");
    let edicaoMontada = false;
    btnEditar.addEventListener("click", () => {
      const abrindo = areaEdicao.classList.contains("hidden");
      areaEdicao.classList.toggle("hidden");
      if (abrindo && !edicaoMontada) {
        montarEdicao(q, areaEdicao, () => { carregarTudo().then(renderizar); });
        edicaoMontada = true;
      }
      btnEditar.textContent = abrindo ? "Fechar" : "Editar";
    });
    card.appendChild(areaEdicao);

    lista.appendChild(card);
  });
  c.appendChild(lista);
  return c;
}

function montarEdicao(q, container, aoSalvar) {
  const { wrap: wrapEnunciado, input: inputEnunciado } = campoTextarea("Enunciado", "", 3);
  inputEnunciado.value = q.enunciado;
  container.appendChild(wrapEnunciado);

  const { wrap: wrapJustificativa, input: inputJustificativa } = campoTextarea("Justificativa", "", 2);
  inputJustificativa.value = q.justificativa || "";
  container.appendChild(wrapJustificativa);

  if (q.tipo === "CE") {
    const wrapGab = criarEl("div", "grid grid-cols-2 gap-2");
    const bC = criarEl("button", `rounded-lg py-2 text-sm ${q.gabarito ? "bg-emerald-500 text-stone-950" : "bg-stone-800 text-stone-400"}`, "Certo");
    const bE = criarEl("button", `rounded-lg py-2 text-sm ${!q.gabarito ? "bg-red-500 text-stone-950" : "bg-stone-800 text-stone-400"}`, "Errado");
    let novoGabarito = q.gabarito;
    bC.addEventListener("click", () => { novoGabarito = true; bC.className = "rounded-lg py-2 text-sm bg-emerald-500 text-stone-950"; bE.className = "rounded-lg py-2 text-sm bg-stone-800 text-stone-400"; });
    bE.addEventListener("click", () => { novoGabarito = false; bE.className = "rounded-lg py-2 text-sm bg-red-500 text-stone-950"; bC.className = "rounded-lg py-2 text-sm bg-stone-800 text-stone-400"; });
    wrapGab.appendChild(bC);
    wrapGab.appendChild(bE);
    container.appendChild(wrapGab);
    container.dataset._getGabarito = "";
    container._pegarGabarito = () => novoGabarito;
  }

  const wrapFlag = criarEl("label", "flex items-center gap-2 text-xs text-stone-400");
  const checkFlag = document.createElement("input");
  checkFlag.type = "checkbox";
  checkFlag.className = "accent-red-500";
  checkFlag.checked = !!q.precisaRevisao;
  wrapFlag.appendChild(checkFlag);
  wrapFlag.appendChild(document.createTextNode("🚩 Marcar para revisar depois"));
  container.appendChild(wrapFlag);

  const btnSalvar = criarEl("button", "w-full bg-amber-500 text-stone-950 font-medium rounded-lg py-2.5 text-sm mt-1", "Salvar edição");
  btnSalvar.addEventListener("click", async () => {
    q.enunciado = inputEnunciado.value.trim();
    q.justificativa = inputJustificativa.value.trim();
    q.precisaRevisao = checkFlag.checked;
    if (q.tipo === "CE" && container._pegarGabarito) q.gabarito = container._pegarGabarito();
    await salvarQuestao(q);
    aoSalvar();
  });
  container.appendChild(btnSalvar);
}

// ---------------------------------------------------------
// Inicialização
// ---------------------------------------------------------
async function iniciar() {
  await ativarModoFallbackSeNecessario();
  await seedInicial();
  await carregarTudo();
  ultimoTimestampSincronizado = Number((await Store.getConfig("firebaseUltimoSyncTs")) || 0);
  configurarFirebase();
  renderizar();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("SW falhou:", err));
    });
  }
}

iniciar();
