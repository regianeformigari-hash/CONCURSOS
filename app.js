// =========================================================
// Lex Revisão v2 — app.js
// IndexedDB (Dexie) · Matérias pré-cadastradas · Importação em massa
// Certo/Errado + Múltipla escolha · SRS por data civil (sem hora)
// Backup/Restore sem login · Estatísticas com Chart.js
// =========================================================

const app = document.getElementById("app");

// ---------------------------------------------------------
// Banco de dados (IndexedDB via Dexie)
// ---------------------------------------------------------
const db = new Dexie("LexRevisaoDB");
db.version(1).stores({
  materias: "++id, nome",
  questoes: "++id, materiaId, tipo, assunto",
});

// Em alguns navegadores/configurações (ex: abrir o arquivo direto do disco no
// Windows) o IndexedDB pode ficar bloqueado. Nesse caso o app cai para uma
// memória temporária, em vez de travar a tela toda.
let USANDO_FALLBACK = false;
let fallbackAutoId = 1;
const fallbackDB = { materias: [], questoes: [] };

const Store = {
  async contarMaterias() {
    return USANDO_FALLBACK ? fallbackDB.materias.length : db.materias.count();
  },
  async addMateria(nome) {
    if (USANDO_FALLBACK) {
      const id = fallbackAutoId++;
      fallbackDB.materias.push({ id, nome });
      return id;
    }
    return db.materias.add({ nome });
  },
  async addQuestao(obj) {
    if (USANDO_FALLBACK) {
      const id = fallbackAutoId++;
      fallbackDB.questoes.push({ ...obj, id });
      return id;
    }
    return db.questoes.add(obj);
  },
  async putQuestao(obj) {
    if (USANDO_FALLBACK) {
      const idx = fallbackDB.questoes.findIndex((q) => q.id === obj.id);
      if (idx >= 0) fallbackDB.questoes[idx] = obj;
      else fallbackDB.questoes.push(obj);
      return obj.id;
    }
    return db.questoes.put(obj);
  },
  async deleteQuestao(id) {
    if (USANDO_FALLBACK) {
      fallbackDB.questoes = fallbackDB.questoes.filter((q) => q.id !== id);
      return;
    }
    return db.questoes.delete(id);
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
      srs: novoSRS(),
    });
  }
}

// Cache em memória (carregado do IndexedDB; toda mutação também grava no banco)
let CACHE_MATERIAS = [];
let CACHE_QUESTOES = [];

async function carregarTudo() {
  CACHE_MATERIAS = await Store.getAllMaterias();
  CACHE_QUESTOES = await Store.getAllQuestoes();
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
  };
  const fn = telas[estado.tela] || telaHome;
  app.appendChild(fn());
  window.scrollTo(0, 0);
}

// ---- HOME ----
function telaHome() {
  const pendentes = CACHE_QUESTOES.filter(estaPendenteHoje);
  const c = criarEl("div", "max-w-md mx-auto px-5 pt-8 pb-24");

  const brand = criarEl("div", "mb-8 flex items-center justify-between");
  const tit = criarEl("div");
  tit.appendChild(criarEl("p", "text-xs tracking-wide text-amber-500/80 mb-1", "Lex Revisão"));
  tit.appendChild(criarEl("h1", "font-serif text-2xl text-stone-100", "Bons estudos."));
  brand.appendChild(tit);
  const btnStats = criarEl("button", "text-stone-400 text-xs border border-stone-800 rounded-lg px-3 py-2", "📊 Estatísticas");
  btnStats.addEventListener("click", () => ir("estatisticas"));
  brand.appendChild(btnStats);
  c.appendChild(brand);

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

  const total = CACHE_QUESTOES.length;
  const acertosTotais = CACHE_QUESTOES.reduce((n, q) => n + q.srs.historico.filter((h) => h.acertou).length, 0);
  const tentativasTotais = CACHE_QUESTOES.reduce((n, q) => n + q.srs.historico.length, 0);
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
        for (const r of registros) {
          await Store.addQuestao({
            materiaId, assunto, tipo: r.tipo,
            enunciado: r.enunciado,
            alternativas: r.alternativas,
            gabarito: r.gabarito,
            justificativa: r.justificativa,
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

  const btnSalvar = criarEl("button", "w-full bg-amber-500 text-stone-950 font-medium rounded-xl py-3.5 mt-2", "Salvar questão");
  btnSalvar.addEventListener("click", async () => {
    const materiaId = Number(selectMateria.value);
    const assunto = inputAssunto.value.trim();
    const enunciado = inputEnunciado.value.trim();
    if (!assunto || !enunciado) { alertaInline(form, "Preencha ao menos o assunto e o enunciado."); return; }

    let payload = { materiaId, assunto, tipo: tipoSelecionado, enunciado, justificativa: inputJustificativa.value.trim(), srs: novoSRS() };
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
  c.appendChild(cabecalho("Treinar por matéria"));

  const lista = criarEl("div", "space-y-3");
  CACHE_MATERIAS.forEach((m) => {
    const qs = CACHE_QUESTOES.filter((q) => q.materiaId === m.id);
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
function telaEstatisticas() {
  const c = criarEl("div", "max-w-md mx-auto px-5 pt-8 pb-24");
  c.appendChild(cabecalho("Estatísticas"));

  const acertosTotais = CACHE_QUESTOES.reduce((n, q) => n + q.srs.historico.filter((h) => h.acertou).length, 0);
  const tentativasTotais = CACHE_QUESTOES.reduce((n, q) => n + q.srs.historico.length, 0);
  const pctGeral = tentativasTotais ? Math.round((acertosTotais / tentativasTotais) * 100) : 0;

  const cardGeral = criarEl("div", "bg-stone-900 border border-stone-800 rounded-2xl p-5 mb-6");
  cardGeral.appendChild(criarEl("p", "text-sm text-stone-400", "Taxa geral de acertos"));
  cardGeral.appendChild(criarEl("p", "font-serif text-4xl text-amber-400 mt-1", tentativasTotais ? `${pctGeral}%` : "—"));
  cardGeral.appendChild(criarEl("p", "text-xs text-stone-500 mt-1", `${acertosTotais} acertos · ${tentativasTotais - acertosTotais} erros · ${tentativasTotais} tentativas`));
  c.appendChild(cardGeral);

  const materiasComDados = CACHE_MATERIAS
    .map((m) => {
      const qs = CACHE_QUESTOES.filter((q) => q.materiaId === m.id);
      const tent = qs.reduce((n, q) => n + q.srs.historico.length, 0);
      const ac = qs.reduce((n, q) => n + q.srs.historico.filter((h) => h.acertou).length, 0);
      return { nome: m.nome, id: m.id, tent, pct: tent ? Math.round((ac / tent) * 100) : null };
    })
    .filter((m) => m.tent > 0);

  if (materiasComDados.length === 0) {
    c.appendChild(criarEl("p", "text-stone-500 text-sm", "Responda algumas questões para ver as estatísticas por matéria."));
    return c;
  }

  c.appendChild(criarEl("p", "text-sm text-stone-400 mb-2", "Desempenho por matéria"));
  const canvasMaterias = document.createElement("canvas");
  canvasMaterias.height = 220;
  const wrapChart = criarEl("div", "bg-stone-900 border border-stone-800 rounded-2xl p-4 mb-6");
  wrapChart.appendChild(canvasMaterias);
  c.appendChild(wrapChart);

  const chart1 = new Chart(canvasMaterias, {
    type: "bar",
    data: {
      labels: materiasComDados.map((m) => m.nome),
      datasets: [{ label: "% de acerto", data: materiasComDados.map((m) => m.pct), backgroundColor: "#C9A24B" }],
    },
    options: {
      indexAxis: "y",
      scales: { x: { min: 0, max: 100, ticks: { color: "#9CA3AF" } }, y: { ticks: { color: "#E7E5E4", font: { size: 10 } } } },
      plugins: { legend: { display: false } },
    },
  });
  graficosAtivos.push(chart1);

  c.appendChild(criarEl("p", "text-sm text-stone-400 mb-2", "Ver detalhe por assunto"));
  const { wrap: wrapSelect, select } = campoSelectMaterias();
  wrapSelect.querySelector("select").innerHTML = "";
  materiasComDados.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.nome;
    select.appendChild(opt);
  });
  wrapSelect.querySelector("button")?.remove(); // sem "+ nova matéria" aqui
  c.appendChild(wrapSelect);

  const areaAssuntos = criarEl("div", "mt-4");
  c.appendChild(areaAssuntos);

  function renderAssuntos() {
    areaAssuntos.innerHTML = "";
    const materiaId = Number(select.value);
    const qs = CACHE_QUESTOES.filter((q) => q.materiaId === materiaId);
    const porAssunto = {};
    qs.forEach((q) => {
      const chave = q.assunto || "(sem assunto)";
      if (!porAssunto[chave]) porAssunto[chave] = { tent: 0, ac: 0 };
      porAssunto[chave].tent += q.srs.historico.length;
      porAssunto[chave].ac += q.srs.historico.filter((h) => h.acertou).length;
    });
    const linhas = Object.entries(porAssunto).filter(([, v]) => v.tent > 0);
    if (linhas.length === 0) {
      areaAssuntos.appendChild(criarEl("p", "text-stone-500 text-sm", "Sem tentativas registradas nesta matéria ainda."));
      return;
    }
    const tabela = criarEl("div", "space-y-2");
    linhas.forEach(([assunto, v]) => {
      const pct = Math.round((v.ac / v.tent) * 100);
      const linha = criarEl("div", "bg-stone-900 border border-stone-800 rounded-xl p-3 flex items-center justify-between");
      linha.innerHTML = `<span class="text-sm text-stone-300">${assunto}</span><span class="text-sm font-medium ${pct >= 70 ? "text-emerald-400" : pct >= 40 ? "text-amber-400" : "text-red-400"}">${pct}%</span>`;
      tabela.appendChild(linha);
    });
    areaAssuntos.appendChild(tabela);
  }
  select.addEventListener("change", renderAssuntos);
  renderAssuntos();

  return c;
}

// ---- BACKUP / RESTAURAR ----
function telaBackup() {
  const c = criarEl("div", "max-w-md mx-auto px-5 pt-8 pb-24");
  c.appendChild(cabecalho("Backup e sincronização", "Sem login — apenas copiar e colar"));

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
    topo.appendChild(criarEl("span", "text-xs text-amber-500/80", `${nomeMateria(q.materiaId)} · ${q.tipo}`));
    const btnExcluir = criarEl("button", "text-xs text-red-400/80", "Excluir");
    btnExcluir.addEventListener("click", async () => {
      await Store.deleteQuestao(q.id);
      await carregarTudo();
      renderizar();
    });
    topo.appendChild(btnExcluir);
    card.appendChild(topo);
    card.appendChild(criarEl("p", "text-sm text-stone-300 font-serif leading-relaxed mb-1", q.enunciado));
    card.appendChild(criarEl("p", "text-xs text-stone-600", `Acertos seguidos: ${q.srs.acertosSeguidos} · Próxima: ${formatarDataBR(q.srs.proximaRevisaoData)}`));
    lista.appendChild(card);
  });
  c.appendChild(lista);
  return c;
}

// ---------------------------------------------------------
// Inicialização
// ---------------------------------------------------------
async function iniciar() {
  await ativarModoFallbackSeNecessario();
  await seedInicial();
  await carregarTudo();
  renderizar();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("SW falhou:", err));
    });
  }
}

iniciar();
