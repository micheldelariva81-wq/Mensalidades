'use strict';
// © 2026 Michel Ebertz. Todos os direitos reservados. Proibido copiar, reproduzir, modificar ou distribuir sem autorização por escrito (Leis 9.610/1998 e 9.609/1998).

// ===================== Utilidades =====================

const VERSAO_APP = 'v5';
const P = PARAMETROS;

const fmtMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = (v) => fmtMoeda.format(Number(v) || 0);
const brl0 = (v) => Calc.brl(v);
const pct = (v, c = 1) => Calc.pct(v, c);

const pad = (x) => String(x).padStart(2, '0');
const isoDe = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoje = () => isoDe(new Date());
const fmtData = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
function somarMeses(iso, m) { const [a, mm, d] = iso.split('-').map(Number); return isoDe(new Date(a, mm - 1 + m, d)); }

// Aceita "1.234,56", "1234,56", "R$ 1.234" ou número. Vazio vira ''.
function lerValor(txt) {
  if (typeof txt === 'number') return txt;
  let s = String(txt || '').replace(/[R$\s%]/g, '');
  if (s === '') return '';
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const v = parseFloat(s);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : '';
}
const mostrarNum = (v) => (v === '' || v === null || v === undefined ? '' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const primeiroNome = (nome) => String(nome || '').trim().split(/\s+/)[0] || '';

function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function setPath(obj, path, val) {
  const ks = path.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) {
    if (o[ks[i]] == null) o[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {};
    o = o[ks[i]];
  }
  o[ks[ks.length - 1]] = val;
}

function avisar(msg) {
  const el = document.getElementById('aviso');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => { el.hidden = true; }, 2600);
}

const modal = () => document.getElementById('modal');
function abrirModal(html) { document.getElementById('modal-corpo').innerHTML = html; modal().showModal(); }
function fecharModal() { modal().close(); }

async function hashPin(pin) {
  const txt = 'pf:' + pin;
  if (crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return btoa(txt);
}

// ===================== Estado =====================

function novoPerfil(nome = '') {
  return {
    id: uid(), criadoEm: hoje(), atualizadoEm: hoje(), etapasFeitas: {}, historico: [],
    pessoal: { nome, idade: '', estadoCivil: 'solteiro', regimeBens: 'parcial', uf: 'SC', profissao: '', tipoRenda: 'clt', dependentes: [] },
    renda: { liquida: '', outras: '', investeMensal: '', brutaAnual: '' },
    despesas: { moradia: '', alimentacao: '', transporte: '', saude: '', educacao: '', lazer: '', outras: '' },
    patrimonio: { reserva: '', rendaFixa: '', acoes: '', fiis: '', exterior: '', cripto: '', pgbl: '', vgbl: '', fgts: '', imoveis: '', veiculos: '', empresa: '', outros: '' },
    dividas: [],
    protecao: { seguroVida: '', seguroInvalidez: false, planoSaude: false },
    objetivos: [],
    aposentadoria: { idadeDesejada: '', rendaDesejada: '', inssEstimado: '', outrasRendas: '', aporteMensal: '' },
    suitability: { respostas: [] },
    tributario: { declaracao: 'nao_sei', contribuiINSS: true, despesasMedicas: '', despesasEducacao: '', aportePGBLAnual: '' },
    sucessao: { testamento: false, holding: false, empresaFamiliar: false, familiaRecomposta: false },
  };
}

function estadoInicial() {
  const p = novoPerfil();
  return { versao: 1, perfis: [p], ativoId: p.id, config: { consentiu: false, modoPlanejador: false, pinHash: '' } };
}

let estado = null;
let aba = 'inicio';
let pedidoInstalar = null; // evento do Chrome que permite instalar o app com um toque
const instalado = () => window.matchMedia('(display-mode: standalone)').matches;
const diasDesde = (iso) => Math.floor((new Date(hoje()) - new Date(iso)) / 86400000);
let etapaAberta = null;
let sim = {};

const perfil = () => estado.perfis.find((p) => p.id === estado.ativoId) || estado.perfis[0];
const planejador = () => !!estado.config.modoPlanejador;

// ---------- Licença do Modo Planejador ----------
// O código é assinado por Michel (licencas/gerar-licenca.js). O app só confere a assinatura
// com a chave pública: sem a chave privada, ninguém cria nem altera um código.

const bytesDeB64url = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};

async function verificarCodigo(codigo) {
  const partes = String(codigo || '').replace(/\s+/g, '').split('.');
  if (partes.length !== 3 || partes[0] !== 'PF1' || !crypto.subtle) return null;
  try {
    const chave = await crypto.subtle.importKey('jwk', { ...P.licenca.chavePublica, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, chave, bytesDeB64url(partes[2]), new TextEncoder().encode(partes[1]));
    if (!ok) return null;
    const d = JSON.parse(new TextDecoder().decode(bytesDeB64url(partes[1])));
    if (!d.n || !/^\d{4}-\d{2}-\d{2}$/.test(d.v)) return null;
    return { codigo: partes.join('.'), nome: d.n, validade: d.v, emitido: d.e };
  } catch {
    return null;
  }
}

const vitalicia = (lic) => lic && lic.validade === '9999-12-31';
const fmtValidade = (lic) => (vitalicia(lic) ? 'vitalícia' : `até ${fmtData(lic.validade)}`);
// Licença em vigor (vale até o fim do dia da validade).
function licencaValida() {
  const lic = estado && estado.config.licenca;
  return lic && hoje() <= lic.validade ? lic : null;
}
const diasParaVencer = (lic) => Math.round((new Date(lic.validade) - new Date(hoje())) / 86400000);

// Título e WhatsApp valem só para o dono da licença que os cadastrou (troca de licença = dados limpos).
function dadosAssessor(lic) {
  const c = (estado && estado.config.assessor) || {};
  return lic && c.dono === lic.nome ? c : {};
}

// Quem atende neste celular: o assessor da licença em vigor (nome travado na licença; título e
// WhatsApp configuráveis). Sem licença válida, o atendimento volta para o padrão (Michel).
function assessor() {
  const lic = licencaValida();
  if (!lic) return { ...P.planejador };
  const c = dadosAssessor(lic);
  const ehAutor = lic.nome === P.planejador.nome;
  return {
    nome: lic.nome,
    titulo: c.titulo || P.planejador.titulo,
    whatsapp: c.whatsapp || (ehAutor ? P.planejador.whatsapp : ''),
  };
}
// Se o assessor ainda não cadastrou o WhatsApp, o contato vai para Michel (e a mensagem também).
const whatsAtendimento = () => assessor().whatsapp || P.planejador.whatsapp;
const nomeAtendimento = () => (assessor().whatsapp ? assessor().nome : P.planejador.nome);

// Crédito fixo da metodologia + responsável pelo atendimento.
function creditos() {
  const a = assessor();
  if (a.nome === P.planejador.nome) return `Metodologia e atendimento: ${P.planejador.nome}, ${a.titulo}`;
  return `Metodologia: ${P.planejador.nome} · Atendimento: ${a.nome}, ${a.titulo}`;
}

// "(49) 99999-9999" vira "5549999999999". Aceita também número já com 55.
function normalizarWhats(txt) {
  const d = String(txt || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10 || d.length === 11) return '55' + d;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return null;
}
const mostrarWhats = (d) => (d && d.length >= 12 ? `(${d.slice(2, 4)}) ${d.slice(4, -4)}-${d.slice(-4)}` : '');

async function salvar() {
  try { await salvarEstado(estado); } catch (e) { avisar('Não foi possível salvar: ' + e.message); }
}

// ===================== Etapas do questionário =====================

const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');
const op = (pares) => pares.map(([v, r]) => [v, r]);

const ETAPAS = [
  {
    id: 'sobre', icone: '👤', titulo: 'Sobre você', resumo: 'Idade, família e trabalho',
    campos: [
      { k: 'pessoal.nome', l: 'Seu nome', t: 'texto' },
      { k: 'pessoal.idade', l: 'Idade', t: 'int' },
      { k: 'pessoal.estadoCivil', l: 'Estado civil', t: 'sel', re: true, op: op([['solteiro', 'Solteiro(a)'], ['casado', 'Casado(a)'], ['uniao', 'União estável'], ['divorciado', 'Divorciado(a)'], ['viuvo', 'Viúvo(a)']]) },
      { k: 'pessoal.regimeBens', l: 'Regime de bens', t: 'sel', se: (pf) => ['casado', 'uniao'].includes(pf.pessoal.estadoCivil), op: op([['parcial', 'Comunhão parcial (o mais comum)'], ['universal', 'Comunhão universal'], ['separacao', 'Separação total'], ['participacao', 'Participação final nos aquestos']]) },
      { k: 'pessoal.uf', l: 'Estado onde mora', t: 'sel', op: UFS.map((u) => [u, u]) },
      { k: 'pessoal.profissao', l: 'Profissão', t: 'texto' },
      { k: 'pessoal.tipoRenda', l: 'Como você ganha a sua renda?', t: 'sel', op: op([['clt', 'Carteira assinada (CLT)'], ['servidor', 'Servidor público'], ['pj', 'PJ / prestador de serviço'], ['autonomo', 'Autônomo / profissional liberal'], ['empresario', 'Empresário'], ['aposentado', 'Aposentado']]) },
    ],
    repetidor: { k: 'pessoal.dependentes', titulo: 'Dependentes (quem depende de você financeiramente)', item: 'Dependente', novo: () => ({ parentesco: 'filho', idade: '' }),
      campos: [{ k: 'parentesco', l: 'Quem é', t: 'sel', op: op([['filho', 'Filho(a)'], ['conjuge', 'Cônjuge'], ['pais', 'Pai/mãe'], ['outro', 'Outro']]) }, { k: 'idade', l: 'Idade', t: 'int' }] },
  },
  {
    id: 'renda', icone: '💵', titulo: 'Renda e gastos', resumo: 'Quanto entra e quanto sai por mês',
    campos: [
      { k: 'renda.liquida', l: 'Renda líquida mensal da família', t: 'moeda', ajuda: 'O que cai na conta, já sem INSS e IR. Some o salário do casal, se dividem as contas.' },
      { k: 'renda.outras', l: 'Outras rendas por mês (aluguel, pensão, extras)', t: 'moeda' },
      { k: 'renda.investeMensal', l: 'Quanto você investe por mês hoje?', t: 'moeda' },
      { k: 'renda.brutaAnual', l: 'Sua renda bruta tributável por ano', t: 'moeda', ajuda: 'Para o cálculo de IR. CLT: salário bruto × 13,33 (inclui 13º e 1/3 de férias). PJ/empresário: pró-labore do ano.' },
      { sec: 'Gastos mensais (sem as parcelas de dívidas)' },
      { k: 'despesas.moradia', l: 'Moradia (aluguel, condomínio, luz, água, internet)', t: 'moeda' },
      { k: 'despesas.alimentacao', l: 'Alimentação (mercado e refeições)', t: 'moeda' },
      { k: 'despesas.transporte', l: 'Transporte (combustível, seguro do carro, app)', t: 'moeda' },
      { k: 'despesas.saude', l: 'Saúde (plano, remédios)', t: 'moeda' },
      { k: 'despesas.educacao', l: 'Educação (escola, cursos)', t: 'moeda' },
      { k: 'despesas.lazer', l: 'Lazer e assinaturas', t: 'moeda' },
      { k: 'despesas.outras', l: 'Outros gastos', t: 'moeda' },
    ],
  },
  {
    id: 'patrimonio', icone: '🏦', titulo: 'Patrimônio', resumo: 'O que você já tem',
    campos: [
      { sec: 'Investimentos' },
      { k: 'patrimonio.reserva', l: 'Dinheiro com liquidez diária (reserva)', t: 'moeda', ajuda: 'Poupança, CDB de liquidez diária, título público pós-fixado, conta remunerada.' },
      { k: 'patrimonio.rendaFixa', l: 'Outras aplicações de renda fixa', t: 'moeda', ajuda: 'CDB, LCI/LCA, títulos públicos, debêntures e fundos de renda fixa que não são a reserva.' },
      { k: 'patrimonio.acoes', l: 'Ações e fundos de ações', t: 'moeda' },
      { k: 'patrimonio.fiis', l: 'Fundos imobiliários', t: 'moeda' },
      { k: 'patrimonio.exterior', l: 'Investimentos no exterior', t: 'moeda' },
      { k: 'patrimonio.cripto', l: 'Criptoativos', t: 'moeda' },
      { k: 'patrimonio.pgbl', l: 'Previdência PGBL', t: 'moeda' },
      { k: 'patrimonio.vgbl', l: 'Previdência VGBL', t: 'moeda' },
      { k: 'patrimonio.fgts', l: 'Saldo do FGTS', t: 'moeda' },
      { sec: 'Bens' },
      { k: 'patrimonio.imoveis', l: 'Imóveis (valor de mercado)', t: 'moeda' },
      { k: 'patrimonio.veiculos', l: 'Veículos', t: 'moeda' },
      { k: 'patrimonio.empresa', l: 'Participação em empresa', t: 'moeda' },
      { k: 'patrimonio.outros', l: 'Outros bens', t: 'moeda' },
    ],
  },
  {
    id: 'dividas', icone: '💳', titulo: 'Dívidas', resumo: 'Cartão, empréstimos e financiamentos',
    campos: [],
    vazioRep: 'Sem dívidas? Ótimo. Toque em "Salvar e continuar".',
    repetidor: { k: 'dividas', titulo: 'Suas dívidas', item: 'Dívida', novo: () => ({ descricao: '', saldo: '', taxaMes: '', parcela: '' }),
      campos: [{ k: 'descricao', l: 'Qual dívida', t: 'texto' }, { k: 'saldo', l: 'Quanto falta pagar', t: 'moeda' }, { k: 'taxaMes', l: 'Juros ao mês (%)', t: 'pct', ajuda: 'Cartão e cheque especial: 8% a 15%. Consignado: cerca de 1,8%. Imobiliário: cerca de 0,9%.' }, { k: 'parcela', l: 'Parcela mensal', t: 'moeda' }] },
  },
  {
    id: 'protecao', icone: '🛡️', titulo: 'Proteção', resumo: 'Seguros e plano de saúde',
    campos: [
      { k: 'protecao.seguroVida', l: 'Capital do seu seguro de vida (somando todos)', t: 'moeda', ajuda: 'Valor que a família recebe. Se não tem, deixe em branco.' },
      { k: 'protecao.seguroInvalidez', l: 'Tenho cobertura para invalidez ou doença grave', t: 'sim' },
      { k: 'protecao.planoSaude', l: 'Tenho plano de saúde', t: 'sim' },
    ],
  },
  {
    id: 'objetivos', icone: '🎯', titulo: 'Objetivos', resumo: 'Seus sonhos com valor e prazo',
    campos: [],
    vazioRep: 'Exemplos: comprar um imóvel, trocar de carro, faculdade dos filhos, uma viagem. A aposentadoria tem etapa própria.',
    repetidor: { k: 'objetivos', titulo: 'Seus objetivos', item: 'Objetivo', novo: () => ({ nome: '', valor: '', anos: '', guardado: '', prioridade: 'media' }),
      campos: [{ k: 'nome', l: 'Objetivo', t: 'texto' }, { k: 'valor', l: 'Quanto custa (em valores de hoje)', t: 'moeda' }, { k: 'anos', l: 'Daqui a quantos anos', t: 'int' }, { k: 'guardado', l: 'Quanto já guardou para ele', t: 'moeda' }, { k: 'prioridade', l: 'Prioridade', t: 'sel', op: op([['alta', 'Alta'], ['media', 'Média'], ['baixa', 'Baixa']]) }] },
  },
  {
    id: 'aposentadoria', icone: '🏖️', titulo: 'Aposentadoria', resumo: 'Quando e com quanto',
    campos: [
      { k: 'aposentadoria.idadeDesejada', l: 'Com quantos anos quer parar de depender do trabalho?', t: 'int' },
      { k: 'aposentadoria.rendaDesejada', l: 'Renda mensal desejada (em valores de hoje)', t: 'moeda', ajuda: 'Em branco, usamos o seu custo de vida atual.' },
      { k: 'aposentadoria.inssEstimado', l: 'Aposentadoria do INSS que espera receber (por mês)', t: 'moeda', ajuda: `Consulte no app Meu INSS. O teto em 2026 é ${brl(P.inss.teto)}.` },
      { k: 'aposentadoria.outrasRendas', l: 'Outras rendas na aposentadoria (aluguéis etc.)', t: 'moeda' },
      { k: 'aposentadoria.aporteMensal', l: 'Quanto por mês vai para a aposentadoria hoje?', t: 'moeda', ajuda: 'Em branco, usamos o que sobra do seu aporte depois dos outros objetivos.' },
    ],
  },
  { id: 'perfil', icone: '🧭', titulo: 'Perfil de investidor', resumo: '8 perguntas rápidas', perfil: true, campos: [] },
  {
    id: 'impostos', icone: '🧾', titulo: 'Imposto de renda', resumo: 'Declaração e previdência',
    campos: [
      { k: 'tributario.declaracao', l: 'Como você declara o IR?', t: 'sel', op: op([['nao_sei', 'Não sei'], ['simplificada', 'Simplificada'], ['completa', 'Completa'], ['nao_declara', 'Não declaro']]) },
      { k: 'tributario.contribuiINSS', l: 'Contribuo para o INSS ou regime próprio', t: 'sim' },
      { k: 'tributario.despesasMedicas', l: 'Despesas médicas por ano (você e dependentes)', t: 'moeda' },
      { k: 'tributario.despesasEducacao', l: 'Despesas com educação formal por ano', t: 'moeda', ajuda: `Limite de dedução: ${brl(P.irAnual.educacaoLimitePessoa)} por pessoa.` },
      { k: 'tributario.aportePGBLAnual', l: 'Quanto aplica em PGBL por ano', t: 'moeda' },
    ],
  },
  {
    id: 'sucessao', icone: '🌳', titulo: 'Sucessão', resumo: 'Proteger quem fica',
    campos: [
      { k: 'sucessao.testamento', l: 'Tenho testamento', t: 'sim' },
      { k: 'sucessao.holding', l: 'Tenho holding patrimonial', t: 'sim' },
      { k: 'sucessao.empresaFamiliar', l: 'Tenho empresa familiar', t: 'sim' },
      { k: 'sucessao.familiaRecomposta', l: 'Tenho filhos de mais de um relacionamento', t: 'sim' },
    ],
  },
];

// ===================== Campos =====================

function campoHtml(c, valor, chave) {
  const k = esc(chave);
  const ajuda = c.ajuda ? `<span class="ajuda">${esc(c.ajuda)}</span>` : '';
  if (c.t === 'sim') {
    return `<label class="check"><input type="checkbox" data-k="${k}" data-t="sim" ${valor ? 'checked' : ''}> ${esc(c.l)}</label>`;
  }
  if (c.t === 'sel') {
    const ops = c.op.map(([v, r]) => `<option value="${esc(v)}" ${String(valor) === String(v) ? 'selected' : ''}>${esc(r)}</option>`).join('');
    return `<label>${esc(c.l)}<select data-k="${k}" data-t="sel" ${c.re ? 'data-re="1"' : ''}>${ops}</select>${ajuda}</label>`;
  }
  const modo = c.t === 'int' ? 'numeric' : c.t === 'texto' ? 'text' : 'decimal';
  const ph = c.t === 'moeda' ? 'R$ 0' : c.t === 'pct' ? '0,0' : '';
  const v = c.t === 'texto' ? valor ?? '' : mostrarNum(valor);
  return `<label>${esc(c.l)}<input type="text" inputmode="${modo}" data-k="${k}" data-t="${c.t}" value="${esc(v)}" placeholder="${ph}" autocomplete="off">${ajuda}</label>`;
}

function lerCampo(el) {
  const t = el.dataset.t;
  if (t === 'sim') return el.checked;
  if (t === 'sel' || t === 'texto') return el.value;
  if (t === 'int') { const v = lerValor(el.value); return v === '' ? '' : Math.round(v); }
  return lerValor(el.value);
}

// ===================== Telas =====================

function render() {
  conferirLicenca();
  limparRelatorio();
  document.querySelectorAll('.abas button').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba));
  const chip = document.getElementById('cliente-ativo');
  chip.hidden = !planejador();
  if (planejador()) chip.textContent = perfil().pessoal.nome || 'Cliente sem nome';
  const telas = { inicio: telaInicio, dados: telaDados, plano: telaPlano, simular: telaSimular, ajustes: telaAjustes };
  const titulos = { inicio: planejador() ? 'Modo Planejador' : 'Planejador Financeiro', dados: 'Seus dados', plano: 'Seu plano', simular: 'Simular', ajustes: 'Ajustes' };
  document.getElementById('titulo').textContent = titulos[aba];
  document.getElementById('conteudo').innerHTML = telas[aba]();
  window.scrollTo(0, 0);
}

function irPara(novaAba) { aba = novaAba; etapaAberta = null; render(); }

function progresso(pf) {
  const feitas = ETAPAS.filter((e) => pf.etapasFeitas[e.id]).length;
  return { feitas, total: ETAPAS.length };
}

function revisaoPendente(pf) {
  const ult = pf.historico[pf.historico.length - 1];
  if (!ult) return null;
  const prox = somarMeses(ult.data, P.premissas.revisaoMeses);
  return { prox, vencida: hoje() >= prox };
}

function avisosTopo() {
  let html = '';
  if (pedidoInstalar && !instalado()) {
    html += `<div class="cartao destaque"><h3>📲 Instale o app no celular</h3>
      <p class="sub">Fica com ícone na tela inicial e funciona sem internet.</p>
      <button class="btn ouro cheio" data-acao="instalar">Instalar</button></div>`;
  }
  const temDados = estado.perfis.some((p) => Object.keys(p.etapasFeitas).length);
  const ult = estado.config.ultimoBackup;
  if (temDados && (!ult || diasDesde(ult) >= 7)) {
    html += `<div class="faixa-aviso">💾 ${ult ? `Último backup há ${diasDesde(ult)} dias.` : 'Você ainda não fez backup.'} Os dados ficam só neste celular: guarde uma cópia no Google Drive ou no seu WhatsApp.
      <div class="botoes"><button class="btn pequeno" data-acao="exportar">Fazer backup agora</button></div></div>`;
  }
  const lic = licencaValida();
  if (planejador() && lic) {
    const dias = diasParaVencer(lic);
    if (!vitalicia(lic) && dias <= P.licenca.avisoDias) {
      html += `<div class="faixa-aviso">🔑 Sua licença do Modo Planejador vence ${dias === 0 ? 'hoje' : `em ${dias} ${dias === 1 ? 'dia' : 'dias'}`} (${fmtData(lic.validade)}). Fale com ${esc(P.planejador.nome)} para renovar.</div>`;
    }
    if (!assessor().whatsapp) {
      html += `<div class="faixa-aviso">📱 Cadastre o seu WhatsApp em <b>Ajustes</b>. Enquanto isso, os contatos dos clientes vão para ${esc(P.planejador.nome)}.</div>`;
    }
  }
  return html;
}

function telaInicio() {
  if (!estado.config.consentiu) return telaBoasVindas();
  if (planejador()) return avisosTopo() + telaClientes();
  const pf = perfil();
  const { feitas, total } = progresso(pf);
  const ult = pf.historico[pf.historico.length - 1];
  const rev = revisaoPendente(pf);
  const nome = primeiroNome(pf.pessoal.nome);
  return `
    ${avisosTopo()}
    ${rev && rev.vencida ? `<div class="faixa-aviso">⏰ Já passaram ${P.premissas.revisaoMeses} meses desde o seu último plano. Atualize os dados e veja sua evolução.</div>` : ''}
    <div class="cartao destaque">
      <h3>${nome ? `Olá, ${esc(nome)}!` : 'Seu planejamento financeiro'}</h3>
      <p class="sub">Etapas preenchidas: ${feitas} de ${total}</p>
      <div class="progresso"><div style="width:${(feitas / total) * 100}%"></div></div>
      ${ult ? `<p>Último Índice de Saúde Financeira: <b>${ult.indice}/100</b> (${fmtData(ult.data)})</p>` : ''}
      <div class="botoes">
        <button class="btn ouro" data-acao="ir" data-aba="dados">${feitas ? 'Continuar preenchendo' : 'Começar'}</button>
        ${feitas ? '<button class="btn" data-acao="ir" data-aba="plano">Ver meu plano</button>' : ''}
      </div>
    </div>
    ${ult && pf.historico.length > 1 ? graficoEvolucao(pf.historico) : ''}
    <h2>Como funciona</h2>
    <div class="cartao">
      <ol style="margin:0;padding-left:20px">
        <li><b>Você conta a sua situação</b>: renda, gastos, patrimônio, dívidas, objetivos.</li>
        <li><b>O app analisa</b> oito áreas: orçamento, reserva, dívidas, investimentos, aposentadoria, proteção, impostos e sucessão.</li>
        <li><b>Você recebe um plano</b> com o Índice de Saúde Financeira e o que fazer em 30 dias, 6 e 12 meses.</li>
        <li><b>Um planejador ajuda a pôr em prática</b>, se você quiser.</li>
        <li><b>Revisão a cada ${P.premissas.revisaoMeses} meses</b> para acompanhar a evolução.</li>
      </ol>
    </div>
    <p class="legal">🔒 Seus dados ficam só neste celular. Nada é enviado sem você pedir.</p>`;
}

function telaBoasVindas() {
  return `
    <div class="cartao destaque">
      <h3>Bem-vindo ao seu planejamento financeiro</h3>
      <p>Em cerca de 15 minutos, você responde perguntas sobre a sua vida financeira e recebe um <b>plano completo</b>, no mesmo método usado por planejadores financeiros profissionais.</p>
      <p>🔒 <b>Privacidade:</b> tudo o que você digitar fica guardado <b>só neste celular</b>. Não há cadastro, login nem servidor.</p>
      <p class="legal">O plano é educativo e usa estimativas. Não é recomendação individual de investimento. Para aplicar o plano com segurança, converse com um profissional.</p>
      <p class="legal">${esc(P.direitos)}</p>
      <form class="campos" onsubmit="return false">
        <label class="check"><input type="checkbox" id="ck-consente"> Li e entendi</label>
      </form>
      <div class="botoes"><button class="btn ouro" data-acao="consentir">Começar</button></div>
    </div>`;
}

function telaClientes() {
  const itens = estado.perfis.map((p) => {
    const ult = p.historico[p.historico.length - 1];
    const { feitas, total } = progresso(p);
    return `<div class="item ${p.id === estado.ativoId ? 'ativo' : ''}" data-acao="ativar" data-id="${p.id}">
      <span class="icone">👤</span>
      <div class="info"><div class="nome">${esc(p.pessoal.nome || 'Cliente sem nome')}</div>
      <div class="detalhe">${feitas}/${total} etapas · ${ult ? `índice ${ult.indice} em ${fmtData(ult.data)}` : 'sem plano ainda'}</div></div>
    </div>`;
  }).join('');
  return `
    <div class="botoes" style="margin-top:0"><button class="btn ouro" data-acao="novo-cliente">+ Novo cliente</button></div>
    <h2>Clientes neste aparelho</h2>
    <div class="lista">${itens}</div>
    <p class="legal" style="margin-top:12px">Toque no cliente para trabalhar com ele. O cliente pode trazer o arquivo .json do app dele (Ajustes &gt; Exportar) e você importa aqui.</p>`;
}

function graficoEvolucao(hist) {
  const pts = hist.slice(-8);
  const w = 320, h = 110, m = 24;
  const x = (i) => m + (i * (w - 2 * m)) / Math.max(1, pts.length - 1);
  const y = (v) => h - 20 - (v / 100) * (h - 36);
  const linha = pts.map((p, i) => `${x(i)},${y(p.indice)}`).join(' ');
  const rot = pts.map((p, i) => `<text x="${x(i)}" y="${h - 4}" text-anchor="middle">${fmtData(p.data).slice(0, 5)}</text><text x="${x(i)}" y="${y(p.indice) - 7}" text-anchor="middle">${p.indice}</text>`).join('');
  return `<div class="cartao"><h3>Sua evolução</h3>
    <svg class="grafico-sim" viewBox="0 0 ${w} ${h}" role="img" aria-label="Evolução do índice"><polyline points="${linha}" fill="none" stroke="var(--destaque)" stroke-width="3"/>${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.indice)}" r="4" fill="var(--destaque)"/>`).join('')}${rot}</svg></div>`;
}

// ---------- Dados ----------

function telaDados() {
  if (!estado.config.consentiu) { aba = 'inicio'; return telaInicio(); }
  if (etapaAberta) return telaEtapa(ETAPAS.find((e) => e.id === etapaAberta));
  const pf = perfil();
  const { feitas, total } = progresso(pf);
  return `
    <div class="progresso"><div style="width:${(feitas / total) * 100}%"></div></div>
    <p class="sub">${feitas} de ${total} etapas. Pode preencher em qualquer ordem; tudo é salvo na hora.</p>
    <div class="lista">${ETAPAS.map((e, i) => `
      <div class="item ${pf.etapasFeitas[e.id] ? 'feito' : ''}" data-acao="etapa" data-id="${e.id}">
        <span class="icone">${e.icone}</span>
        <div class="info"><div class="nome">${i + 1}. ${esc(e.titulo)}</div><div class="detalhe">${esc(e.resumo)}</div></div>
        <span>›</span>
      </div>`).join('')}
    </div>
    ${feitas >= 3 ? '<div class="botoes"><button class="btn ouro cheio" data-acao="ir" data-aba="plano">Gerar meu plano</button></div>' : ''}`;
}

function telaEtapa(e) {
  const pf = perfil();
  const idx = ETAPAS.indexOf(e);
  let corpo = '';
  if (e.perfil) {
    const resp = pf.suitability.respostas || [];
    corpo = Calc.QUESTOES_PERFIL.map((q, i) => `
      <div class="questao"><div class="perg">${i + 1}. ${esc(q.p)}</div>
      ${q.o.map((o, j) => `<label class="check"><input type="radio" name="q${i}" data-k="suitability.respostas.${i}" data-t="int" value="${j}" ${resp[i] === j ? 'checked' : ''}> ${esc(o)}</label>`).join('')}
      </div>`).join('');
  } else {
    corpo = e.campos.filter((c) => !c.se || c.se(pf)).map((c) => (c.sec ? `<h3 style="margin-top:8px">${esc(c.sec)}</h3>` : campoHtml(c, getPath(pf, c.k), c.k))).join('');
  }
  if (e.repetidor) {
    const R = e.repetidor;
    const itens = getPath(pf, R.k) || [];
    corpo += `<h3 style="margin-top:8px">${esc(R.titulo)}</h3>`;
    if (!itens.length && e.vazioRep) corpo += `<p class="sub">${esc(e.vazioRep)}</p>`;
    corpo += itens.map((it, i) => `
      <div class="bloco-rep">
        <div class="topo-rep">${esc(R.item)} ${i + 1}<button type="button" class="btn secundario pequeno" data-acao="rep-remover" data-k="${R.k}" data-i="${i}">Remover</button></div>
        ${R.campos.map((c) => campoHtml(c, it[c.k], `${R.k}.${i}.${c.k}`)).join('')}
      </div>`).join('');
    corpo += `<button type="button" class="btn secundario" data-acao="rep-add" data-id="${e.id}">+ Adicionar ${esc(R.item.toLowerCase())}</button>`;
  }
  const prox = ETAPAS[idx + 1];
  return `
    <p class="sub">Etapa ${idx + 1} de ${ETAPAS.length}</p>
    <h2 style="margin-top:4px">${e.icone} ${esc(e.titulo)}</h2>
    <form class="campos" onsubmit="return false">${corpo}</form>
    <div class="botoes">
      <button class="btn secundario" data-acao="voltar-etapas">Voltar</button>
      <button class="btn ouro" data-acao="concluir-etapa" data-id="${e.id}">${prox ? 'Salvar e continuar' : 'Salvar e ver o plano'}</button>
    </div>`;
}

// ---------- Plano ----------

const corNota = (v) => (v >= 80 ? '#15803d' : v >= 60 ? '#2563eb' : v >= 40 ? '#d97706' : '#b91c1c');
const ICONE = { ok: '✅', info: 'ℹ️', atencao: '⚠️', risco: '❗' };

function svgIndice(v) {
  const r = 54, c = 2 * Math.PI * r;
  return `<svg class="gauge" viewBox="0 0 140 140" role="img" aria-label="Índice ${v} de 100">
    <circle cx="70" cy="70" r="${r}" class="g-fundo"/>
    <circle cx="70" cy="70" r="${r}" class="g-valor" stroke="${corNota(v)}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - v / 100)}" transform="rotate(-90 70 70)"/>
    <text x="70" y="76" class="g-num">${v}</text><text x="70" y="98" class="g-rot">de 100</text></svg>`;
}

function registrarHistorico(pf, indice) {
  const ult = pf.historico[pf.historico.length - 1];
  if (ult && ult.data === hoje()) { if (ult.indice === indice) return; ult.indice = indice; }
  else pf.historico.push({ data: hoje(), indice });
  salvar();
}

function telaPlano() {
  if (!estado.config.consentiu) { aba = 'inicio'; return telaInicio(); }
  const pf = perfil();
  const r = Calc.calcular(pf);
  if (r.incompleto) {
    return `<div class="vazio">Para gerar o plano, falta preencher: <b>${r.faltando.map(esc).join(', ')}</b>.</div>
      <div class="botoes"><button class="btn ouro" data-acao="ir" data-aba="dados">Preencher dados</button></div>`;
  }
  registrarHistorico(pf, r.indice);
  const nome = pf.pessoal.nome || 'você';
  const prazos = ['30 dias', '6 meses', '12 meses'];
  let n = 0;
  const planoAcao = prazos.map((pz) => {
    const lista = r.acoes.filter((a) => a.prazo === pz);
    if (!lista.length) return '';
    return `<div class="prazo-titulo">Próximos ${pz}</div>` + lista.map((a) => `
      <div class="acao"><div class="num">${++n}</div><div><div class="t">${esc(a.titulo)}</div><div class="d">${esc(a.texto)}</div></div></div>`).join('');
  }).join('');

  const dominios = r.dominios.map((d) => {
    const aplic = d.aplicavel !== false && d.nota !== null;
    let extra = '';
    if (d.id === 'investimentos') {
      const al = d.dados.alocacao;
      extra = `<h3 style="margin-top:12px">Carteira sugerida para o perfil ${esc(d.dados.perfil)}</h3>
        <table class="tabela">${Object.entries(al).filter(([, v]) => v > 0).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v}%</td></tr>`).join('')}</table>
        <p class="legal" style="margin-top:6px">Classes de ativos, não produtos específicos. A escolha dos ativos deve ser feita com um profissional.</p>`;
    }
    return `<div class="cartao">
      <div class="dom-topo"><h3 style="margin:0">${esc(d.nome)}</h3>${aplic ? `<span class="nota" style="color:${corNota(d.nota)}">${d.nota}</span>` : '<span class="sub">não avaliado</span>'}</div>
      <ul class="achados">${d.achados.map((a) => `<li class="${a.tipo}">${ICONE[a.tipo] || ''} ${esc(a.texto)}</li>`).join('')}</ul>
      ${extra}
    </div>`;
  }).join('');

  const barras = r.dominios.filter((d) => d.aplicavel !== false && d.nota !== null).map((d) => `
    <div class="barra-linha"><span>${esc(d.nome)}</span><div class="barra"><div style="width:${d.nota}%;background:${corNota(d.nota)}"></div></div><b>${d.nota}</b></div>`).join('');

  const faltam = ETAPAS.filter((e) => !pf.etapasFeitas[e.id]).length;
  const botaoRelatorio = faltam === 0
    ? '<button class="btn ouro" data-acao="relatorio">📑 Relatório completo para o cliente</button>'
    : `<p class="sub" style="width:100%">📑 O relatório completo em PDF (com todos os dados) é liberado quando as 10 etapas estiverem preenchidas. Falta${faltam > 1 ? 'm' : ''} ${faltam}.</p>`;

  return `
    <div class="so-relatorio">${capaRelatorio(pf, r)}</div>
    <div class="so-impressao">
      <h2 style="margin:0">Plano Financeiro de ${esc(pf.pessoal.nome || '')}</h2>
      <p class="sub">Gerado em ${fmtData(hoje())} · ${esc(creditos())}</p>
    </div>
    <div class="cartao">
      <div class="cabeca-plano">${svgIndice(r.indice)}
        <div><div class="rotulo">Índice de Saúde Financeira</div><div class="faixa" style="color:${corNota(r.indice)}">${esc(r.faixa)}</div>
        <p class="sub" style="margin-top:6px">${esc(primeiroNome(nome))}, este é o retrato da sua vida financeira hoje. Abaixo estão as notas de cada área e o passo a passo para melhorar.</p></div>
      </div>
    </div>
    <div class="cartao"><h3>Notas por área</h3><div class="barras">${barras}</div></div>
    <div class="cartao destaque"><h3>Seu plano de ação</h3>${planoAcao || '<p>Parabéns! Nenhuma ação urgente. Mantenha o plano e revise a cada 6 meses.</p>'}</div>
    <div class="botoes nao-imprimir">
      <button class="btn whats" data-acao="whats">💬 Quero implementar com um planejador</button>
      <button class="btn" data-acao="pdf">📄 PDF do plano</button>
      ${botaoRelatorio}
    </div>
    <h2>Análise por área</h2>
    ${dominios}
    <div class="cartao">
      <h3>Premissas usadas</h3>
      <ul class="legal" style="margin:0;padding-left:18px">
        <li>Rentabilidade real (acima da inflação): ${pct(r.premissas.jurosReal)} ao ano. Todos os valores estão em reais de hoje.</li>
        <li>Patrimônio da aposentadoria calculado para durar até os ${r.premissas.expectativaVida} anos; para viver só de renda, retirada de ${pct(r.premissas.retiradaSegura)} ao ano.</li>
        <li>Imposto de renda 2026 com a redução da Lei 15.270/2025; INSS 2026; ITCMD de SC pela Lei 13.136/2004 (demais estados: ${pct(P.sucessao.itcmd.padrao, 0)} estimado). Inventário: advogado ${pct(P.sucessao.honorarios, 0)} e custas ${pct(P.sucessao.custas, 0)}.</li>
        <li>Tabelas conferidas em ${esc(r.premissas.verificadoEm)}.</li>
      </ul>
      <p class="legal" style="margin-top:8px">Este plano é educativo e foi gerado a partir das informações que você forneceu. Não constitui recomendação individual de investimento nem consultoria jurídica ou contábil. Rentabilidades passadas e estimativas não garantem resultados futuros.</p>
      <p class="legal">${esc(creditos())}</p>
      <p class="legal">${esc(P.direitos)}</p>
    </div>
    <div class="so-relatorio">${anexoDados(pf, r)}</div>`;
}

// ---------- Relatório completo (PDF para o cliente) ----------

function capaRelatorio(pf, r) {
  const a = assessor();
  const whats = whatsAtendimento();
  return `<div class="capa">
    <div class="capa-marca">Planejador Financeiro</div>
    <h1>Relatório de Planejamento Financeiro</h1>
    <p class="capa-cliente">${esc(pf.pessoal.nome || 'Cliente')}</p>
    <p class="sub">Elaborado em ${fmtData(hoje())}</p>
    <div class="capa-indice">${svgIndice(r.indice)}<div><div class="rotulo">Índice de Saúde Financeira</div><div class="faixa" style="color:${corNota(r.indice)}">${esc(r.faixa)}</div></div></div>
    <table class="tabela capa-sumario">
      <tr><td>1. Plano de ação e notas por área</td></tr>
      <tr><td>2. Análise por área</td></tr>
      <tr><td>3. Anexo: dados informados pelo cliente</td></tr>
      <tr><td>4. Declaração e assinaturas</td></tr>
    </table>
    <p><b>Atendimento:</b> ${esc(nomeAtendimento())}${nomeAtendimento() === a.nome ? `, ${esc(a.titulo)}` : ''} · WhatsApp ${esc(mostrarWhats(whats))}</p>
    <p><b>Metodologia:</b> ${esc(P.planejador.nome)}</p>
    <p class="legal">Documento confidencial: contém dados pessoais e financeiros protegidos pela LGPD (Lei 13.709/2018). Destinado exclusivamente ao cliente identificado acima.</p>
  </div>`;
}

function valorCampo(c, v) {
  if (c.t === 'sim') return v ? 'Sim' : 'Não';
  if (v === '' || v === null || v === undefined) return '—';
  if (c.t === 'moeda') return brl(v);
  if (c.t === 'pct') return `${mostrarNum(v)}% ao mês`;
  if (c.t === 'sel') { const o = c.op.find(([x]) => String(x) === String(v)); return o ? o[1] : String(v); }
  return String(v);
}

function anexoDados(pf, r) {
  const A = r.agregados;
  const sobra = A.rendaMensal - A.gastos - A.parcelas;
  const linha = (rot, val) => `<tr><td>${esc(rot)}</td><td class="num">${esc(val)}</td></tr>`;
  let html = `<div class="quebra"></div><h2>Anexo: dados informados pelo cliente</h2>
    <p class="sub">Informações fornecidas por ${esc(pf.pessoal.nome || 'o cliente')} e usadas nos cálculos deste plano. Valores mensais, exceto quando indicado.</p>
    <div class="cartao"><h3>Resumo financeiro</h3><table class="tabela">
      ${linha('Renda mensal (líquida + outras)', brl(A.rendaMensal))}
      ${linha('Gastos mensais', brl(A.gastos))}
      ${linha('Parcelas de dívidas por mês', brl(A.parcelas))}
      ${linha('Sobra mensal', brl(sobra))}
      ${linha('Investe por mês', brl(A.investe))}
      ${linha('Patrimônio financeiro', brl(A.financeiro))}
      ${linha('Patrimônio total', brl(A.total))}
      ${linha('Dívidas', brl(A.totalDividas))}
      ${linha('Patrimônio líquido', brl(A.liquido))}
    </table></div>`;

  ETAPAS.forEach((e, i) => {
    let corpo = '';
    if (e.perfil) {
      const resp = pf.suitability.respostas || [];
      const { perfil: pfInv } = Calc.perfilInvestidor(resp);
      corpo = `<table class="tabela">${Calc.QUESTOES_PERFIL.map((q, j) => linha(`${j + 1}. ${q.p}`, resp[j] === undefined || resp[j] === null ? '—' : q.o[resp[j]])).join('')}</table>
        <p style="margin-top:6px"><b>Resultado: perfil ${esc(pfInv || 'não definido')}</b></p>`;
    } else {
      const linhas = e.campos.filter((c) => !c.se || c.se(pf)).map((c) => (c.sec
        ? `<tr><th colspan="2">${esc(c.sec)}</th></tr>`
        : linha(c.l, valorCampo(c, getPath(pf, c.k))))).join('');
      if (linhas) corpo += `<table class="tabela">${linhas}</table>`;
    }
    if (e.repetidor) {
      const R = e.repetidor;
      const itens = getPath(pf, R.k) || [];
      corpo += `<h3 style="margin-top:10px">${esc(R.titulo)}</h3>`;
      corpo += itens.length
        ? `<table class="tabela"><tr>${R.campos.map((c) => `<th>${esc(c.l)}</th>`).join('')}</tr>${itens.map((it) => `<tr>${R.campos.map((c) => `<td>${esc(valorCampo(c, it[c.k]))}</td>`).join('')}</tr>`).join('')}</table>`
        : '<p class="sub">Nenhum informado.</p>';
    }
    html += `<div class="cartao"><h3>${i + 1}. ${esc(e.titulo)}</h3>${corpo}</div>`;
  });

  html += `<div class="cartao assinaturas">
    <h3>Declaração</h3>
    <p>Declaro que as informações deste relatório foram fornecidas por mim e refletem a minha situação financeira em ${fmtData(hoje())}. Estou ciente de que o plano é educativo, baseado em estimativas, e de que não constitui recomendação individual de investimento.</p>
    <div class="linhas-assinatura">
      <div><span></span>${esc(pf.pessoal.nome || 'Cliente')}<br><small>Cliente</small></div>
      <div><span></span>${esc(nomeAtendimento())}<br><small>Assessor responsável pelo atendimento</small></div>
    </div>
    <p class="legal">Local e data: ______________________, ____/____/______</p>
    <p class="legal">${esc(P.direitos)}</p>
  </div>`;
  return html;
}

function pedirRelatorio() {
  const pf = perfil();
  abrirModal(`
    <h3>Relatório completo</h3>
    <p>O PDF terá capa, o plano completo, <b>todos os dados informados</b> e a declaração para assinatura.</p>
    <p class="faixa-aviso">🔒 O documento contém dados pessoais e financeiros de ${esc(pf.pessoal.nome || 'cliente')} (LGPD). Envie apenas para o próprio cliente.</p>
    <p class="sub">Na tela seguinte, escolha <b>Salvar como PDF</b> e toque em salvar. Depois, envie o arquivo pelo WhatsApp ou e-mail do cliente.</p>
    <div class="botoes"><button class="btn secundario" data-acao="fechar">Cancelar</button><button class="btn ouro" data-acao="gerar-relatorio">Gerar PDF</button></div>`);
}

function gerarRelatorio() {
  const pf = perfil();
  fecharModal();
  document.body.classList.add('relatorio');
  document.title = `Relatorio financeiro completo - ${pf.pessoal.nome || 'cliente'} - ${fmtData(hoje()).replace(/\//g, '-')}`;
  // No Android a impressão não bloqueia: a limpeza fica para o fim da impressão ou para a próxima tela.
  window.addEventListener('afterprint', limparRelatorio, { once: true });
  window.print();
}

function limparRelatorio() {
  document.body.classList.remove('relatorio');
  document.title = 'Planejador Financeiro';
}

function mensagemWhats(pf, r) {
  const prior = r.acoes.slice(0, 3).map((a, i) => `${i + 1}. ${a.titulo}`).join('\n');
  return `Olá, ${primeiroNome(nomeAtendimento())}! Fiz meu planejamento no app Planejador Financeiro e quero ajuda para colocar em prática.\n\n` +
    `Nome: ${pf.pessoal.nome || ''}\nIdade: ${pf.pessoal.idade || ''}\nEstado: ${pf.pessoal.uf || ''}\n` +
    `Índice de Saúde Financeira: ${r.indice}/100 (${r.faixa})\n` +
    (prior ? `\nMinhas prioridades:\n${prior}` : '');
}

function abrirWhats() {
  const pf = perfil();
  const r = Calc.calcular(pf);
  if (r.incompleto) return;
  abrirModal(`
    <h3>Falar com o planejador</h3>
    <p class="sub">O WhatsApp vai abrir com a mensagem abaixo. Você pode editar o texto. Nada é enviado até você tocar em enviar no WhatsApp.</p>
    <form class="campos" onsubmit="return false">
      <textarea id="msg-whats">${esc(mensagemWhats(pf, r))}</textarea>
      <label class="check"><input type="checkbox" id="ck-lgpd"> Autorizo ${esc(nomeAtendimento())} a usar estas informações para entrar em contato comigo (LGPD).</label>
    </form>
    <div class="botoes"><button class="btn secundario" data-acao="fechar">Cancelar</button><button class="btn whats" data-acao="enviar-whats">Abrir WhatsApp</button></div>`);
}

function imprimirPlano() {
  const pf = perfil();
  const antes = document.title;
  document.title = `Plano financeiro - ${pf.pessoal.nome || 'cliente'} - ${fmtData(hoje()).replace(/\//g, '-')}`;
  window.print();
  setTimeout(() => { document.title = antes; }, 1000);
}

// ---------- Simular ----------

function serieAcumulo(d, idade, jurosReal) {
  const i = Calc.taxaMensal(jurosReal);
  const pts = [];
  for (let a = idade; a <= d.idadeAp; a++) pts.push([a, Calc.vf(d.base, d.aporte, i, (a - idade) * 12)]);
  return pts;
}

function graficoSimulacao(atual, novo, idade, rA, rN) {
  const sA = serieAcumulo(atual, idade, rA);
  const sN = serieAcumulo(novo, idade, rN);
  const maxIdade = Math.max(atual.idadeAp, novo.idadeAp, idade + 1);
  const maxV = Math.max(atual.necessario, novo.necessario, ...sA.map((p) => p[1]), ...sN.map((p) => p[1]), 1) * 1.08;
  const w = 340, h = 190, mx = 8, my = 14;
  const x = (a) => mx + ((a - idade) / Math.max(1, maxIdade - idade)) * (w - 2 * mx);
  const y = (v) => h - 24 - (v / maxV) * (h - 24 - my);
  const pl = (s) => s.map(([a, v]) => `${x(a).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `<svg class="grafico-sim" viewBox="0 0 ${w} ${h}" role="img" aria-label="Patrimônio projetado até a aposentadoria">
    <line x1="${mx}" x2="${w - mx}" y1="${h - 24}" y2="${h - 24}" stroke="var(--borda)"/>
    <line x1="${mx}" x2="${w - mx}" y1="${y(novo.necessario)}" y2="${y(novo.necessario)}" stroke="var(--risco)" stroke-dasharray="5 4"/>
    <polyline points="${pl(sA)}" fill="none" stroke="var(--suave)" stroke-width="2.5"/>
    <polyline points="${pl(sN)}" fill="none" stroke="var(--destaque)" stroke-width="3"/>
    <text x="${mx}" y="${h - 8}">${idade} anos</text><text x="${w - mx}" y="${h - 8}" text-anchor="end">${maxIdade} anos</text>
    <text x="${w - mx}" y="${y(novo.necessario) - 5}" text-anchor="end">necessário: ${brl0(novo.necessario)}</text>
  </svg>
  <div class="legenda"><span><i style="background:var(--suave)"></i>Hoje</span><span><i style="background:var(--destaque)"></i>Simulação</span><span><i style="background:var(--risco)"></i>Meta</span></div>`;
}

function telaSimular() {
  if (!estado.config.consentiu) { aba = 'inicio'; return telaInicio(); }
  const pf = perfil();
  const base = Calc.calcular(pf);
  if (base.incompleto) return `<div class="vazio">Preencha primeiro: <b>${base.faltando.map(esc).join(', ')}</b>.</div>`;
  const ajustes = {
    jurosReal: sim.jurosReal !== undefined && sim.jurosReal !== '' ? sim.jurosReal / 100 : undefined,
    idadeAposentadoria: sim.idadeAposentadoria || undefined,
    aporteExtra: sim.aporteExtra || 0,
    rendaDesejada: sim.rendaDesejada || undefined,
  };
  const novo = Calc.calcular(pf, ajustes);
  const apA = base.dominios.find((d) => d.id === 'aposentadoria');
  const apN = novo.dominios.find((d) => d.id === 'aposentadoria');
  const linha = (rot, a, b) => `<tr><td>${rot}</td><td class="num">${a}</td><td class="num"><b>${b}</b></td></tr>`;
  const idadeTxt = (v) => (v ? `${v} anos` : 'acima de 85');
  return `
    <p class="sub">Teste cenários sem mudar os seus dados. Deixe em branco para usar o valor atual.</p>
    <form class="campos" onsubmit="return false">
      <div class="linha">
        <label>Rentabilidade real (% ao ano)<input type="text" inputmode="decimal" data-sim="jurosReal" value="${esc(mostrarNum(sim.jurosReal))}" placeholder="${mostrarNum(P.premissas.jurosReal * 100)}"></label>
        <label>Idade para se aposentar<input type="text" inputmode="numeric" data-sim="idadeAposentadoria" value="${esc(mostrarNum(sim.idadeAposentadoria))}" placeholder="${apA.dados.idadeAp}"></label>
      </div>
      <div class="linha">
        <label>Aporte extra por mês<input type="text" inputmode="decimal" data-sim="aporteExtra" value="${esc(mostrarNum(sim.aporteExtra))}" placeholder="R$ 0"></label>
        <label>Renda desejada por mês<input type="text" inputmode="decimal" data-sim="rendaDesejada" value="${esc(mostrarNum(sim.rendaDesejada))}" placeholder="${esc(mostrarNum(Math.round(apA.dados.renda)))}"></label>
      </div>
    </form>
    <div class="cartao" style="margin-top:12px">${graficoSimulacao(apA.dados, apN.dados, Number(pf.pessoal.idade), base.premissas.jurosReal, novo.premissas.jurosReal)}</div>
    <div class="cartao">
      <table class="tabela">
        <tr><th></th><th class="num">Hoje</th><th class="num">Simulação</th></tr>
        ${linha('Índice de Saúde Financeira', base.indice, novo.indice)}
        ${linha('Nota da aposentadoria', apA.nota, apN.nota)}
        ${linha('Aporte mensal', brl0(apA.dados.aporte), brl0(apN.dados.aporte))}
        ${linha('Patrimônio projetado', brl0(apA.dados.projetado), brl0(apN.dados.projetado))}
        ${linha('Patrimônio necessário', brl0(apA.dados.necessario), brl0(apN.dados.necessario))}
        ${linha('Aporte necessário', brl0(apA.dados.aporteNecessario), brl0(apN.dados.aporteNecessario))}
        ${linha('Aposentadoria possível aos', idadeTxt(apA.dados.idadePossivel), idadeTxt(apN.dados.idadePossivel))}
      </table>
    </div>
    <div class="botoes"><button class="btn secundario" data-acao="limpar-sim">Limpar simulação</button></div>`;
}

// ---------- Ajustes ----------

function telaAjustes() {
  const pf = perfil();
  const rev = revisaoPendente(pf);
  return `
    <h2 style="margin-top:4px">Seus dados</h2>
    <div class="cartao">
      <p class="sub">Os dados ficam só neste celular. Faça uma cópia de segurança de vez em quando, ou para levar ao planejador.</p>
      <div class="botoes">
        <button class="btn" data-acao="exportar">⬇️ Exportar (.json)</button>
        <button class="btn secundario" data-acao="importar">⬆️ Importar</button>
      </div>
      <input type="file" id="arq-importar" accept=".json,application/json" hidden>
      ${rev ? `<p class="sub" style="margin-top:10px">Próxima revisão do plano: <b>${fmtData(rev.prox)}</b></p>` : ''}
    </div>

    <h2>Modo Planejador</h2>
    <div class="cartao">
      <p class="sub">Para uso do planejador em reunião: vários clientes no mesmo aparelho, protegidos por PIN.</p>
      ${planejador()
        ? '<button class="btn secundario cheio" data-acao="sair-planejador">Sair do Modo Planejador</button>'
        : `<button class="btn cheio" data-acao="entrar-planejador">${estado.config.pinHash ? 'Entrar com PIN' : 'Ativar (criar PIN)'}</button>`}
    </div>

    ${planejador() ? telaAssessor() : ''}

    <h2>Apagar</h2>
    <div class="cartao">
      <button class="btn perigo cheio" data-acao="apagar">${planejador() ? 'Apagar este cliente' : 'Apagar todos os meus dados'}</button>
    </div>

    <h2>Sobre</h2>
    <div class="cartao legal">
      <p>Planejador Financeiro ${VERSAO_APP} · tabelas conferidas em ${esc(P.verificadoEm)}.</p>
      <p>${esc(creditos())}.</p>
      <p>O plano é educativo e não substitui a recomendação individual de um profissional.</p>
      <p>${esc(P.direitos)}</p>
    </div>`;
}

// Só aparece no Modo Planejador (com PIN), para o cliente não trocar o contato.
function telaAssessor() {
  const c = dadosAssessor(licencaValida());
  const lic = licencaValida();
  return `
    <h2>Seus dados de assessor</h2>
    <div class="cartao">
      <p class="sub">Aparecem no plano, no PDF e no botão do WhatsApp deste celular. A metodologia continua creditada a ${esc(P.planejador.nome)}.</p>
      <form class="campos" onsubmit="return false">
        <label>Nome (definido pela licença)<input type="text" value="${esc(lic.nome)}" disabled></label>
        <label>Título profissional<input type="text" id="as-titulo" value="${esc(c.titulo || '')}" placeholder="${esc(P.planejador.titulo)}"></label>
        <label>WhatsApp com DDD<input type="text" inputmode="tel" id="as-whats" value="${esc(mostrarWhats(c.whatsapp))}" placeholder="(49) 99999-9999" autocomplete="tel"></label>
      </form>
      <div class="botoes"><button class="btn ouro" data-acao="assessor-salvar">Salvar</button></div>
      <p class="sub" style="margin-top:8px">${esc(creditos())}</p>
    </div>
    <h2>Licença</h2>
    <div class="cartao">
      <p>🔑 <b>${esc(lic.nome)}</b> · ${fmtValidade(lic)}</p>
      <button class="btn secundario cheio" data-acao="trocar-licenca">Inserir novo código (renovação)</button>
    </div>`;
}

async function salvarAssessor() {
  const titulo = document.getElementById('as-titulo').value.trim();
  const whats = normalizarWhats(document.getElementById('as-whats').value);
  if (whats === null) return avisar('WhatsApp inválido. Use DDD + número, ex.: (49) 99999-9999.');
  estado.config.assessor = { dono: licencaValida().nome, titulo, whatsapp: whats };
  await salvar();
  render();
  avisar('Dados do assessor salvos.');
}

function pedirCodigo(motivo = '') {
  abrirModal(`
    <h3>Código de ativação</h3>
    ${motivo ? `<p class="faixa-aviso">${esc(motivo)}</p>` : ''}
    <p class="sub">O Modo Planejador é licenciado por ${esc(P.planejador.nome)}. Cole o código que você recebeu.</p>
    <form class="campos" onsubmit="return false">
      <textarea id="codigo-licenca" placeholder="PF1...." style="min-height:110px;font-family:monospace;font-size:0.8rem"></textarea>
    </form>
    <div class="botoes"><button class="btn secundario" data-acao="fechar">Cancelar</button><button class="btn ouro" data-acao="confirmar-codigo">Ativar</button></div>
    <p class="legal" style="margin-top:10px">Não tem código? Fale com ${esc(P.planejador.nome)}: <a href="https://wa.me/${P.planejador.whatsapp}" target="_blank" rel="noopener">WhatsApp</a>.</p>`);
}

async function confirmarCodigo() {
  const lic = await verificarCodigo(document.getElementById('codigo-licenca').value);
  if (!lic) return avisar('Código inválido. Confira se copiou o código inteiro.');
  if (hoje() > lic.validade) return avisar(`Este código venceu em ${fmtData(lic.validade)}.`);
  const anterior = estado.config.licenca;
  if (anterior && anterior.nome !== lic.nome && estado.perfis.some((p) => Object.keys(p.etapasFeitas).length)) {
    if (!confirm(`Este código é de ${lic.nome}, e este celular estava licenciado para ${anterior.nome}. Continuar?`)) return;
  }
  estado.config.licenca = lic;
  await salvar();
  fecharModal();
  avisar(`Licença ativada: ${lic.nome}, ${fmtValidade(lic)}.`);
  if (!planejador()) pedirPin(); else render();
}

// Licença vencida ou removida: sai do Modo Planejador (os dados continuam guardados).
function conferirLicenca() {
  if (planejador() && !licencaValida()) {
    estado.config.modoPlanejador = false;
    salvar();
    const lic = estado.config.licenca;
    avisar(lic ? `Licença vencida em ${fmtData(lic.validade)}. Fale com ${P.planejador.nome} para renovar.` : 'Modo Planejador exige licença.');
    return false;
  }
  return true;
}

function exportar() {
  const dados = planejador()
    ? { tipo: 'planejador-financeiro', versao: 1, exportadoEm: hoje(), perfis: estado.perfis }
    : { tipo: 'planejador-financeiro', versao: 1, exportadoEm: hoje(), perfis: [perfil()] };
  const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  const nome = planejador() ? 'clientes' : (primeiroNome(perfil().pessoal.nome) || 'meu-plano').toLowerCase();
  a.href = URL.createObjectURL(blob);
  a.download = `planejamento-${nome}-${hoje()}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  estado.config.ultimoBackup = hoje();
  salvar();
  if (aba === 'inicio') render();
  avisar('Backup salvo em Downloads. Envie para o Google Drive ou para o seu WhatsApp.');
}

function normalizarPerfil(p) {
  const base = novoPerfil();
  const out = { ...base, ...p };
  for (const k of ['pessoal', 'renda', 'despesas', 'patrimonio', 'protecao', 'aposentadoria', 'suitability', 'tributario', 'sucessao']) out[k] = { ...base[k], ...(p[k] || {}) };
  for (const k of ['dividas', 'objetivos', 'historico']) out[k] = Array.isArray(p[k]) ? p[k] : [];
  out.pessoal.dependentes = Array.isArray(out.pessoal.dependentes) ? out.pessoal.dependentes : [];
  out.etapasFeitas = p.etapasFeitas || {};
  out.id = p.id || uid();
  return out;
}

async function importar(arquivo) {
  try {
    const dados = JSON.parse(await arquivo.text());
    const lista = dados.tipo === 'planejador-financeiro' ? dados.perfis : dados.pessoal ? [dados] : null;
    if (!Array.isArray(lista) || !lista.length) throw new Error('arquivo não é deste app');
    const perfis = lista.map(normalizarPerfil);
    if (planejador()) {
      for (const p of perfis) {
        const i = estado.perfis.findIndex((x) => x.id === p.id);
        if (i >= 0) estado.perfis[i] = p; else estado.perfis.push(p);
      }
      estado.ativoId = perfis[0].id;
      avisar(`${perfis.length} cliente(s) importado(s).`);
    } else {
      if (!confirm('Importar vai substituir os dados atuais deste celular. Continuar?')) return;
      estado.perfis = [perfis[0]];
      estado.ativoId = perfis[0].id;
      avisar('Dados importados.');
    }
    await salvar();
    render();
  } catch (e) {
    avisar('Não foi possível importar: ' + e.message);
  }
}

function pedirPin() {
  const criando = !estado.config.pinHash;
  abrirModal(`
    <h3>${criando ? 'Criar PIN do Modo Planejador' : 'PIN do Modo Planejador'}</h3>
    <form class="campos" onsubmit="return false">
      <label>PIN (4 a 8 números)<input type="password" inputmode="numeric" id="pin" maxlength="8" autocomplete="off"></label>
      ${criando ? '<label>Repita o PIN<input type="password" inputmode="numeric" id="pin2" maxlength="8" autocomplete="off"></label>' : ''}
    </form>
    <div class="botoes"><button class="btn secundario" data-acao="fechar">Cancelar</button><button class="btn ouro" data-acao="confirmar-pin">Entrar</button></div>`);
}

async function confirmarPin() {
  const pin = document.getElementById('pin').value.trim();
  if (!/^\d{4,8}$/.test(pin)) return avisar('O PIN deve ter de 4 a 8 números.');
  const h = await hashPin(pin);
  if (!estado.config.pinHash) {
    if (pin !== document.getElementById('pin2').value.trim()) return avisar('Os PINs não conferem.');
    estado.config.pinHash = h;
  } else if (h !== estado.config.pinHash) {
    return avisar('PIN incorreto.');
  }
  estado.config.modoPlanejador = true;
  await salvar();
  fecharModal();
  aba = 'inicio';
  render();
}

async function apagar() {
  if (planejador()) {
    const pf = perfil();
    if (!confirm(`Apagar o cliente "${pf.pessoal.nome || 'sem nome'}" deste aparelho?`)) return;
    estado.perfis = estado.perfis.filter((p) => p.id !== pf.id);
    if (!estado.perfis.length) estado.perfis.push(novoPerfil());
    estado.ativoId = estado.perfis[0].id;
  } else {
    if (!confirm('Apagar todos os seus dados deste celular? Não dá para desfazer.')) return;
    const cfg = estado.config;
    estado = estadoInicial();
    estado.config.pinHash = cfg.pinHash;
    estado.config.assessor = cfg.assessor || {};
    estado.config.licenca = cfg.licenca;
  }
  await salvar();
  irPara('inicio');
}

// ===================== Eventos =====================

document.addEventListener('click', async (ev) => {
  const abaBtn = ev.target.closest('.abas button');
  if (abaBtn) return irPara(abaBtn.dataset.aba);
  const el = ev.target.closest('[data-acao]');
  if (!el) return;
  const pf = perfil();
  switch (el.dataset.acao) {
    case 'ir': return irPara(el.dataset.aba);
    case 'consentir':
      if (!document.getElementById('ck-consente').checked) return avisar('Marque "Li e entendi" para começar.');
      estado.config.consentiu = true;
      await salvar();
      return irPara('dados');
    case 'etapa': etapaAberta = el.dataset.id; return render();
    case 'voltar-etapas': etapaAberta = null; return render();
    case 'concluir-etapa': {
      pf.etapasFeitas[el.dataset.id] = true;
      pf.atualizadoEm = hoje();
      await salvar();
      const idx = ETAPAS.findIndex((e) => e.id === el.dataset.id);
      if (idx < ETAPAS.length - 1) { etapaAberta = ETAPAS[idx + 1].id; return render(); }
      return irPara('plano');
    }
    case 'rep-add': {
      const R = ETAPAS.find((e) => e.id === el.dataset.id).repetidor;
      const lista = getPath(pf, R.k) || [];
      lista.push(R.novo());
      setPath(pf, R.k, lista);
      await salvar();
      return render();
    }
    case 'rep-remover': {
      const lista = getPath(pf, el.dataset.k) || [];
      lista.splice(Number(el.dataset.i), 1);
      await salvar();
      return render();
    }
    case 'whats': return abrirWhats();
    case 'enviar-whats': {
      if (!document.getElementById('ck-lgpd').checked) return avisar('Marque a autorização para continuar.');
      const msg = document.getElementById('msg-whats').value;
      window.open(`https://wa.me/${whatsAtendimento()}?text=${encodeURIComponent(msg)}`, '_blank');
      return fecharModal();
    }
    case 'pdf': return imprimirPlano();
    case 'relatorio': return pedirRelatorio();
    case 'gerar-relatorio': return gerarRelatorio();
    case 'fechar': return fecharModal();
    case 'limpar-sim': sim = {}; return render();
    case 'exportar': return exportar();
    case 'importar': return document.getElementById('arq-importar').click();
    case 'entrar-planejador': {
      if (licencaValida()) return pedirPin();
      const lic = estado.config.licenca;
      return pedirCodigo(lic ? `A licença de ${lic.nome} venceu em ${fmtData(lic.validade)}. Insira o código de renovação.` : '');
    }
    case 'confirmar-pin': return confirmarPin();
    case 'sair-planejador':
      estado.config.modoPlanejador = false;
      await salvar();
      return irPara('inicio');
    case 'novo-cliente': {
      const p = novoPerfil();
      estado.perfis.push(p);
      estado.ativoId = p.id;
      await salvar();
      etapaAberta = 'sobre';
      aba = 'dados';
      return render();
    }
    case 'ativar':
      estado.ativoId = el.dataset.id;
      sim = {};
      await salvar();
      return irPara('dados');
    case 'apagar': return apagar();
    case 'assessor-salvar': return salvarAssessor();
    case 'confirmar-codigo': return confirmarCodigo();
    case 'trocar-licenca': return pedirCodigo();
    case 'instalar':
      if (!pedidoInstalar) return avisar('No Chrome, toque no menu ⋮ e em "Instalar app".');
      pedidoInstalar.prompt();
      await pedidoInstalar.userChoice;
      pedidoInstalar = null;
      return render();
  }
});

document.addEventListener('change', async (ev) => {
  const el = ev.target;
  if (el.id === 'arq-importar' && el.files[0]) { await importar(el.files[0]); el.value = ''; return; }
  if (el.dataset.sim) { sim[el.dataset.sim] = lerValor(el.value); return render(); }
  if (!el.dataset.k) return;
  const pf = perfil();
  const val = el.type === 'radio' ? Number(el.value) : lerCampo(el);
  setPath(pf, el.dataset.k, val);
  pf.atualizadoEm = hoje();
  if (el.dataset.t !== 'texto' && el.dataset.t !== 'sel' && el.dataset.t !== 'sim' && el.type !== 'radio') el.value = mostrarNum(val);
  if (el.dataset.k === 'pessoal.nome' && planejador()) document.getElementById('cliente-ativo').textContent = val || 'Cliente sem nome';
  await salvar();
  if (el.dataset.re) render();
});

// O Chrome avisa quando o app pode ser instalado; guardamos o aviso para o botão "Instalar".
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  pedidoInstalar = e;
  if (estado && aba === 'inicio') render();
});
window.addEventListener('appinstalled', () => { pedidoInstalar = null; avisar('App instalado! Procure o ícone na tela inicial.'); });

// ===================== Início =====================

async function iniciar() {
  try {
    const salvo = await carregarEstado();
    estado = salvo || estadoInicial();
    estado.perfis = (estado.perfis || []).map(normalizarPerfil);
    if (!estado.perfis.length) estado.perfis.push(novoPerfil());
    if (!estado.perfis.some((p) => p.id === estado.ativoId)) estado.ativoId = estado.perfis[0].id;
    estado.config = { consentiu: false, modoPlanejador: false, pinHash: '', ...(estado.config || {}) };
    // Relê a licença de dentro do código assinado: nome e validade editados à mão são desfeitos.
    if (estado.config.licenca) estado.config.licenca = await verificarCodigo(estado.config.licenca.codigo);
  } catch (e) {
    estado = estadoInicial();
    avisar('Armazenamento indisponível: os dados não serão salvos.');
  }
  conferirLicenca();
  pedirArmazenamentoPersistente();
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

iniciar();
