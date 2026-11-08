'use strict';

// ===================== Utilidades =====================

const fmtMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = (v) => fmtMoeda.format(Number(v) || 0);
const numBR = (v) => (Number(v) || 0).toFixed(2).replace('.', ',');

const pad = (n) => String(n).padStart(2, '0');
const isoDe = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dataDe = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };
const hoje = () => isoDe(new Date());
const somarDias = (iso, n) => { const d = dataDe(iso); d.setDate(d.getDate() + n); return isoDe(d); };
const diasEntre = (de, ate) => Math.round((dataDe(ate) - dataDe(de)) / 86400000);
const fmtData = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const fmtDiaMes = (iso) => (iso ? fmtData(iso).slice(0, 5) : '');

const compDe = (iso) => iso.slice(0, 7);
const compAtual = () => compDe(hoje());
const somarComp = (comp, n) => { const [a, m] = comp.split('-').map(Number); const d = new Date(a, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const fmtComp = (comp) => { const [a, m] = comp.split('-'); return `${m}/${a}`; };
const nomeMes = (comp) => { const [a, m] = comp.split('-').map(Number); const t = new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); };
const mesCurto = (comp) => { const [a, m] = comp.split('-').map(Number); return new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''); };

function vencimentoDe(comp, dia) {
  const [a, m] = comp.split('-').map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  return `${comp}-${pad(Math.min(Math.max(1, dia), ultimo))}`;
}

function lerValor(txt) {
  if (typeof txt === 'number') return txt;
  let s = String(txt || '').replace(/[R$\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const v = parseFloat(s);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const primeiroNome = (nome) => String(nome || '').trim().split(/\s+/)[0] || '';

function avisar(msg) {
  const el = document.getElementById('aviso');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => { el.hidden = true; }, 2600);
}

// ===================== Estado =====================

const MSG_LEMBRETE = 'Olá, {nome}! Passando para lembrar que sua mensalidade de {competencia}, no valor de {valor}, vence em {vencimento}. Pix: {pix}. Oss!';
const MSG_ATRASO = 'Olá, {nome}, tudo bem? Consta em aberto a mensalidade de {competencia} ({valor}), vencida em {vencimento}. Se já pagou, desconsidere. Pix: {pix}. Obrigado!';

function estadoInicial() {
  return {
    versao: 1,
    alunos: [],
    mensalidades: [],
    config: {
      academia: '',
      valorPadrao: 170,
      tolerancia: 3,
      pix: '',
      msgLembrete: MSG_LEMBRETE,
      msgAtraso: MSG_ATRASO,
      tetoMei: 81000,
      diasSumido: 60,
      ultimaCompGerada: null,
      // Recibos
      responsavel: '',
      documento: '', // CNPJ do MEI ou CPF de quem assina
      cidade: '',
      proxRecibo: 1,
    },
    ultimoBackup: null,
  };
}

let E = estadoInicial();
const ui = { aba: 'painel', comp: compAtual(), filtroMes: 'todas', busca: '', filtroAlunos: 'ativos', anoRel: new Date().getFullYear() };

async function persistir() {
  await salvarEstado(E);
}

const alunoPorId = (id) => E.alunos.find((a) => a.id === id);
const mensPorId = (id) => E.mensalidades.find((m) => m.id === id);
// Nome do aluno da mensalidade: do cadastro ou, se o aluno foi excluído, o nome gravado no pagamento.
const nomeDaMens = (m) => { const a = alunoPorId(m.alunoId); return a ? a.nome : (m.alunoNome || 'Aluno removido'); };

// ===================== Regras de negócio =====================

function situacao(m) {
  if (m.status === 'aberta' && hoje() > somarDias(m.venc, Number(E.config.tolerancia) || 0)) return 'atrasada';
  return m.status;
}
const diasAtraso = (m) => Math.max(0, diasEntre(m.venc, hoje()));
const ROTULO = { paga: 'Paga', aberta: 'Em aberto', atrasada: 'Atrasada', cancelada: 'Cancelada' };

function inicioAluno(a) {
  const c1 = compDe(a.matricula || a.criadoEm);
  const c2 = compDe(a.criadoEm);
  return c1 > c2 ? c1 : c2;
}

// Cria a mensalidade do aluno na competência, se ainda não existir.
function gerarParaAluno(a, comp) {
  if (!a.ativo || comp < inicioAluno(a)) return false;
  if (E.mensalidades.some((m) => m.alunoId === a.id && m.comp === comp)) return false;
  E.mensalidades.push({
    id: uid(), alunoId: a.id, comp, venc: vencimentoDe(comp, Number(a.diaVenc) || 10),
    valor: Number(a.valor) || Number(E.config.valorPadrao) || 0,
    status: 'aberta', dataPag: null, valorPago: null, forma: null, ultimoAviso: null,
  });
  return true;
}

function gerarCompetencia(comp) {
  let n = 0;
  E.alunos.forEach((a) => { if (gerarParaAluno(a, comp)) n++; });
  if (!E.config.ultimaCompGerada || comp > E.config.ultimaCompGerada) E.config.ultimaCompGerada = comp;
  return n;
}

// Ao abrir: gera todos os meses que faltam até o mês atual (cobre meses em que o app não foi aberto).
function gerarPendentes() {
  const atual = compAtual();
  let comp = E.config.ultimaCompGerada ? somarComp(E.config.ultimaCompGerada, 1) : atual;
  let n = 0;
  while (comp <= atual) { n += gerarCompetencia(comp); comp = somarComp(comp, 1); }
  return n;
}

function mensalidadesDoAluno(id) {
  return E.mensalidades.filter((m) => m.alunoId === id).sort((x, y) => y.comp.localeCompare(x.comp));
}

function atrasadasDoAluno(id) {
  return E.mensalidades.filter((m) => m.alunoId === id && situacao(m) === 'atrasada').sort((x, y) => x.comp.localeCompare(y.comp));
}

// ---------- Sumidos (ativos há muito tempo sem pagar) ----------
function ultimoPagamento(id) {
  return E.mensalidades.filter((m) => m.alunoId === id && m.status === 'paga' && m.dataPag)
    .reduce((max, m) => (m.dataPag > max ? m.dataPag : max), '') || null;
}
// Sem nenhum pagamento, conta a partir da matrícula.
const diasSemPagar = (a) => diasEntre(ultimoPagamento(a.id) || a.matricula || a.criadoEm, hoje());
const ehSumido = (a) => a.ativo && diasSemPagar(a) >= (Number(E.config.diasSumido) || 60);

// ---------- Saídas (churn) ----------
const MOTIVOS_SAIDA = ['Financeiro', 'Horário', 'Mudou de cidade', 'Lesão ou saúde', 'Perdeu o interesse', 'Foi para outra academia', 'Não informou', 'Outro'];
const saidaAtual = (a) => (!a.ativo && a.saidas && a.saidas.length ? a.saidas[a.saidas.length - 1] : null);

// Aluno estava ativo na data? null = não dá para saber (inativado antes do registro de saídas).
function ativoEm(a, iso) {
  if ((a.matricula || a.criadoEm) > iso) return false;
  const s = a.saidas || [];
  if (!a.ativo && !s.length) return null;
  return !s.some((x) => x.data <= iso && (!x.retorno || x.retorno > iso));
}

function recebidoEntre(de, ate) {
  return E.mensalidades.filter((m) => m.status === 'paga' && m.dataPag >= de && m.dataPag <= ate);
}

// ===================== WhatsApp =====================

function numeroWhats(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d.length >= 12 && d.length <= 13 ? d : null;
}

function montarMensagem(modelo, aluno, lista) {
  const total = lista.reduce((s, m) => s + Number(m.valor), 0);
  const comps = lista.map((m) => fmtComp(m.comp));
  const competencia = comps.length > 1 ? comps.slice(0, -1).join(', ') + ' e ' + comps[comps.length - 1] : comps[0] || '';
  const vars = {
    nome: primeiroNome(aluno.nome),
    nome_completo: aluno.nome,
    competencia,
    valor: brl(total),
    vencimento: lista[0] ? fmtData(lista[0].venc) : '',
    dias: lista[0] ? String(diasAtraso(lista[0])) : '',
    pix: E.config.pix || '(consultar)',
    academia: E.config.academia || '',
  };
  return modelo.replace(/\{(\w+)\}/g, (t, k) => (k in vars ? vars[k] : t));
}

async function enviarWhats(alunoId, tipo, mensIds) {
  const a = alunoPorId(alunoId);
  if (!a) return;
  const num = numeroWhats(a.telefone);
  if (!num) { avisar('Telefone inválido. Edite o cadastro do aluno (DDD + número).'); return; }
  const lista = mensIds.map(mensPorId).filter(Boolean).sort((x, y) => x.comp.localeCompare(y.comp));
  const modelo = tipo === 'lembrete' ? E.config.msgLembrete : E.config.msgAtraso;
  const texto = montarMensagem(modelo, a, lista);
  window.open(`https://wa.me/${num}?text=${encodeURIComponent(texto)}`, '_blank');
  lista.forEach((m) => { m.ultimoAviso = hoje(); });
  await persistir();
  render();
}

// ===================== Recibos =====================

// Valor por extenso em reais (até milhões), ex.: 170 -> "cento e setenta reais".
function porExtenso(valor) {
  const U = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const D = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const C = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  const ate999 = (n) => {
    if (n === 0) return '';
    if (n === 100) return 'cem';
    const partes = [];
    const ce = Math.floor(n / 100);
    const r = n % 100;
    if (ce) partes.push(C[ce]);
    if (r) partes.push(r < 20 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? ' e ' + U[r % 10] : ''));
    return partes.join(' e ');
  };
  const total = Math.round((Number(valor) || 0) * 100);
  const inteiro = Math.floor(total / 100);
  const cent = total % 100;
  const mi = Math.floor(inteiro / 1e6);
  const mil = Math.floor((inteiro % 1e6) / 1000);
  const un = inteiro % 1000;
  const grupos = [];
  if (mi) grupos.push(ate999(mi) + (mi === 1 ? ' milhão' : ' milhões'));
  if (mil) grupos.push(mil === 1 ? 'mil' : ate999(mil) + ' mil');
  if (un) grupos.push(ate999(un));
  let reais = '';
  grupos.forEach((g, i) => {
    if (i === 0) { reais = g; return; }
    const ultimo = i === grupos.length - 1;
    reais += (ultimo && un && (un < 100 || un % 100 === 0) ? ' e ' : ' ') + g;
  });
  if (inteiro) reais += mi && !mil && !un ? ' de reais' : inteiro === 1 ? ' real' : ' reais';
  const centavos = cent ? `${ate999(cent)} ${cent === 1 ? 'centavo' : 'centavos'}` : '';
  if (!inteiro && !cent) return 'zero reais';
  return [reais, centavos].filter(Boolean).join(' e ');
}

const dataPorExtenso = (iso) => { const d = dataDe(iso); return `${d.getDate()} de ${d.toLocaleDateString('pt-BR', { month: 'long' })} de ${d.getFullYear()}`; };
const numRecibo = (n) => String(n).padStart(4, '0');

// Dá número ao recibo na primeira vez; depois, reenviar usa o mesmo número.
async function garantirNumero(m) {
  if (m.recibo) return m.recibo;
  m.recibo = Number(E.config.proxRecibo) || 1;
  m.reciboEm = hoje();
  E.config.proxRecibo = m.recibo + 1;
  await persistir();
  return m.recibo;
}

function dadosRecibo(m) {
  const c = E.config;
  return {
    numero: numRecibo(m.recibo),
    aluno: nomeDaMens(m),
    valor: brl(m.valorPago),
    extenso: porExtenso(m.valorPago),
    referente: `mensalidade de ${nomeMes(m.comp).toLowerCase()} (${fmtComp(m.comp)})`,
    pagoEm: fmtData(m.dataPag),
    forma: m.forma || '',
    local: `${c.cidade ? c.cidade + ', ' : ''}${dataPorExtenso(m.reciboEm || hoje())}`,
    academia: c.academia || '',
    responsavel: c.responsavel || '',
    documento: c.documento || '',
  };
}

function textoReciboWhats(m) {
  const r = dadosRecibo(m);
  return [
    `🧾 *RECIBO Nº ${r.numero}*`,
    r.academia ? `*${r.academia}*${r.documento ? ` · CNPJ/CPF ${r.documento}` : ''}` : '',
    '',
    `Recebemos de *${r.aluno}* a importância de *${r.valor}* (${r.extenso}), referente à ${r.referente}, paga em ${r.pagoEm}${r.forma ? ` via ${r.forma}` : ''}.`,
    '',
    `${r.local}.`,
    r.responsavel ? `${r.responsavel}${r.academia ? ` · ${r.academia}` : ''}` : '',
    '',
    'Obrigado! Oss! 🥋',
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim(); // tira linhas vazias repetidas (campos não preenchidos)
}

function htmlRecibo(m) {
  const r = dadosRecibo(m);
  return `
    <div class="recibo">
      <div class="recibo-topo">
        <div><div class="recibo-titulo">RECIBO</div><div class="recibo-num">Nº ${esc(r.numero)}</div></div>
        <div class="recibo-valor">${esc(r.valor)}</div>
      </div>
      ${r.academia ? `<div class="recibo-emissor">${esc(r.academia)}${r.documento ? ` · CNPJ/CPF ${esc(r.documento)}` : ''}</div>` : ''}
      <p>Recebemos de <b>${esc(r.aluno)}</b> a importância de <b>${esc(r.valor)}</b> (${esc(r.extenso)}), referente à ${esc(r.referente)}, paga em ${esc(r.pagoEm)}${r.forma ? ` via ${esc(r.forma)}` : ''}.</p>
      <p>Para clareza, firmamos o presente recibo.</p>
      <p class="recibo-local">${esc(r.local)}.</p>
      <div class="recibo-assinatura"><span></span>${esc(r.responsavel || 'Responsável')}${r.academia ? `<br><small>${esc(r.academia)}</small>` : ''}</div>
    </div>`;
}

// ===================== Modal =====================

const modal = document.getElementById('modal');
const modalCorpo = document.getElementById('modal-corpo');
function abrirModal(html) { modalCorpo.innerHTML = html; if (!modal.open) modal.showModal(); }
function fecharModal() { if (modal.open) modal.close(); }
modal.addEventListener('click', (e) => { if (e.target === modal) fecharModal(); });

// ===================== Ações =====================

const acoes = {
  // ---------- Alunos ----------
  formAluno(id) {
    const a = id ? alunoPorId(id) : null;
    const v = a || { nome: '', telefone: '', matricula: hoje(), diaVenc: 10, valor: E.config.valorPadrao, obs: '' };
    abrirModal(`
      <h3>${a ? 'Editar aluno' : 'Novo aluno'}</h3>
      <form class="campos" id="f-aluno">
        <label>Nome completo<input name="nome" required value="${esc(v.nome)}" autocomplete="off"></label>
        <label>WhatsApp (DDD + número)<input name="telefone" type="tel" inputmode="tel" placeholder="49 99999-9999" value="${esc(v.telefone)}"></label>
        <div class="linha">
          <label>Dia do vencimento<input name="diaVenc" type="number" min="1" max="31" required value="${esc(v.diaVenc)}"></label>
          <label>Mensalidade (R$)<input name="valor" inputmode="decimal" required value="${esc(numBR(v.valor))}"></label>
        </div>
        <label>Data da matrícula<input name="matricula" type="date" required value="${esc(v.matricula)}"></label>
        <label>Observações<textarea name="obs" placeholder="Faixa, plano, desconto, responsável...">${esc(v.obs)}</textarea></label>
        ${a ? '<p class="ajuda">Mudanças de valor e de dia de vencimento valem para as mensalidades em aberto deste mês em diante.</p>' : ''}
        <div class="botoes">
          <button type="button" class="btn secundario" onclick="fecharModal()">Cancelar</button>
          <button type="submit" class="btn ok">Salvar</button>
        </div>
      </form>`);
    document.getElementById('f-aluno').onsubmit = async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const valor = lerValor(f.get('valor'));
      const dia = parseInt(f.get('diaVenc'), 10);
      if (!Number.isFinite(valor) || valor < 0) { avisar('Valor inválido.'); return; }
      if (!(dia >= 1 && dia <= 31)) { avisar('Dia de vencimento deve ser de 1 a 31.'); return; }
      const dados = {
        nome: String(f.get('nome')).trim(), telefone: String(f.get('telefone')).trim(),
        diaVenc: dia, valor, matricula: f.get('matricula'), obs: String(f.get('obs')).trim(),
      };
      if (a) {
        Object.assign(a, dados);
        E.mensalidades
          .filter((m) => m.alunoId === a.id && m.status === 'aberta' && m.comp >= compAtual())
          .forEach((m) => { m.valor = valor; m.venc = vencimentoDe(m.comp, dia); });
      } else {
        const novo = { id: uid(), ativo: true, criadoEm: hoje(), ...dados };
        E.alunos.push(novo);
        const ate = E.config.ultimaCompGerada && E.config.ultimaCompGerada > compAtual() ? E.config.ultimaCompGerada : compAtual();
        for (let c = inicioAluno(novo); c <= ate; c = somarComp(c, 1)) gerarParaAluno(novo, c);
      }
      await persistir();
      fecharModal();
      avisar(a ? 'Cadastro atualizado.' : 'Aluno cadastrado.');
      render();
    };
  },

  fichaAluno(id) {
    const a = alunoPorId(id);
    if (!a) return;
    const ms = mensalidadesDoAluno(id);
    const totalPago = ms.filter((m) => m.status === 'paga').reduce((s, m) => s + Number(m.valorPago), 0);
    const atrasadas = atrasadasDoAluno(id);
    const saida = saidaAtual(a);
    const ultPag = ultimoPagamento(a.id);
    abrirModal(`
      <h3>${esc(a.nome)}</h3>
      <div class="detalhe">${a.ativo ? (ehSumido(a) ? `<span class="etiqueta atrasada">Sumido: ${diasSemPagar(a)} dias sem pagar</span><br>` : '') : '<span class="etiqueta cancelada">Inativo</span> '}
        ${saida ? `Saiu em ${fmtData(saida.data)} · Motivo: ${esc(saida.motivo)}${saida.obs ? ' (' + esc(saida.obs) + ')' : ''}<br>` : ''}
        WhatsApp: ${esc(a.telefone || '-')}<br>
        Vence todo dia ${a.diaVenc} · ${brl(a.valor)}<br>
        Matrícula: ${fmtData(a.matricula)}${a.obs ? '<br>Obs.: ' + esc(a.obs) : ''}<br>
        Último pagamento: ${ultPag ? fmtData(ultPag) : 'nenhum'}<br>
        <b>Total pago: ${brl(totalPago)}</b>
      </div>
      <div class="botoes">
        <button class="btn pequeno" onclick="acoes.formAluno('${a.id}')">Editar</button>
        ${atrasadas.length ? `<button class="btn whats pequeno" onclick="enviarWhats('${a.id}','atraso',${esc(JSON.stringify(atrasadas.map((m) => m.id)))})">Cobrar atraso</button>` : ''}
        <button class="btn secundario pequeno" onclick="acoes.alternarAtivo('${a.id}')">${a.ativo ? 'Inativar' : 'Reativar'}</button>
        <button class="btn perigo pequeno" onclick="acoes.excluirAluno('${a.id}')">Excluir</button>
      </div>
      <h2>Histórico</h2>
      <div class="lista">${ms.length ? ms.map((m) => itemMensalidade(m, { semNome: true })).join('') : '<div class="vazio">Sem mensalidades.</div>'}</div>
      <div class="botoes"><button class="btn secundario" onclick="fecharModal()">Fechar</button></div>`);
  },

  async alternarAtivo(id) {
    const a = alunoPorId(id);
    if (a.ativo) { acoes.formSaida(id); return; }
    a.ativo = true;
    const s = a.saidas && a.saidas[a.saidas.length - 1];
    if (s && !s.retorno) s.retorno = hoje();
    gerarParaAluno(a, compAtual());
    await persistir();
    avisar('Aluno reativado.');
    acoes.fichaAluno(id);
    render();
  },

  // Inativar com data e motivo da saída (alimenta o churn nos Relatórios).
  formSaida(id) {
    const a = alunoPorId(id);
    abrirModal(`
      <h3>Inativar ${esc(a.nome)}</h3>
      <form class="campos" id="f-saida">
        <label>Data da saída<input name="data" type="date" required value="${hoje()}"></label>
        <label>Motivo<select name="motivo" required>${MOTIVOS_SAIDA.map((m) => `<option>${esc(m)}</option>`).join('')}</select></label>
        <label>Observação<textarea name="obs" placeholder="Opcional"></textarea></label>
        <label class="check"><input type="checkbox" name="cancelar" checked> Cancelar as mensalidades em aberto que vencem depois da saída</label>
        <p class="ajuda">Mensalidades vencidas até a data da saída continuam em aberto, como dívida. Os pagamentos já recebidos não mudam.</p>
        <div class="botoes">
          <button type="button" class="btn secundario" onclick="acoes.fichaAluno('${a.id}')">Voltar</button>
          <button type="submit" class="btn perigo">Inativar</button>
        </div>
      </form>`);
    document.getElementById('f-saida').onsubmit = async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const data = f.get('data');
      a.ativo = false;
      a.saidas = [...(a.saidas || []), { data, motivo: f.get('motivo'), obs: String(f.get('obs')).trim() }];
      let n = 0;
      if (f.get('cancelar')) {
        E.mensalidades
          .filter((m) => m.alunoId === a.id && m.status === 'aberta' && m.venc > data)
          .forEach((m) => { m.status = 'cancelada'; n++; });
      }
      await persistir();
      avisar(`Aluno inativado.${n ? ` ${n} mensalidade(s) cancelada(s).` : ''}`);
      acoes.fichaAluno(id);
      render();
    };
  },

  async excluirAluno(id) {
    const a = alunoPorId(id);
    const pagas = E.mensalidades.filter((m) => m.alunoId === id && m.status === 'paga');
    const outras = E.mensalidades.filter((m) => m.alunoId === id && m.status !== 'paga');
    if (!confirm(`Excluir o cadastro de ${a.nome}?\n\n` +
      `• ${pagas.length} pagamento(s) recebido(s) ficam guardados nos relatórios, no teto do MEI e no CSV.\n` +
      `• ${outras.length} mensalidade(s) em aberto ou cancelada(s) serão apagadas.\n\n` +
      `Isso não pode ser desfeito. Para só parar de cobrar, use "Inativar".`)) return;
    pagas.forEach((m) => { m.alunoNome = a.nome; });
    E.mensalidades = E.mensalidades.filter((m) => m.alunoId !== id || m.status === 'paga');
    E.alunos = E.alunos.filter((x) => x.id !== id);
    await persistir();
    fecharModal();
    avisar(`Cadastro excluído. ${pagas.length} pagamento(s) mantido(s).`);
    render();
  },

  // ---------- Mensalidades ----------
  detalheMens(id) {
    const m = mensPorId(id);
    const a = alunoPorId(m.alunoId);
    const s = situacao(m);
    abrirModal(`
      <h3>${esc(nomeDaMens(m))}${a ? '' : ' <span class="etiqueta cancelada">Excluído</span>'}</h3>
      <div class="detalhe">
        Competência: <b>${fmtComp(m.comp)}</b> · <span class="etiqueta ${s}">${ROTULO[s]}</span><br>
        Vencimento: ${fmtData(m.venc)} · Valor: ${brl(m.valor)}<br>
        ${m.status === 'paga' ? `Pago em ${fmtData(m.dataPag)} · ${brl(m.valorPago)} · ${esc(m.forma)}<br>` : ''}
        ${s === 'atrasada' ? `${diasAtraso(m)} dias de atraso<br>` : ''}
        ${m.ultimoAviso ? `Último aviso: ${fmtData(m.ultimoAviso)}` : ''}
        ${a ? '' : '<p class="ajuda">O cadastro deste aluno foi excluído. O pagamento fica guardado para os relatórios e não pode ter a baixa desfeita.</p>'}
      </div>
      <div class="botoes">
        ${m.status === 'aberta' ? `<button class="btn ok" onclick="acoes.formBaixa('${m.id}')">Dar baixa</button>` : ''}
        ${m.status === 'aberta' && a ? `<button class="btn whats" onclick="enviarWhats('${a.id}','${s === 'atrasada' ? 'atraso' : 'lembrete'}',['${m.id}'])">WhatsApp</button>` : ''}
        ${m.status === 'paga' ? `<button class="btn" onclick="acoes.recibo('${m.id}')">🧾 Recibo${m.recibo ? ` nº ${numRecibo(m.recibo)}` : ''}</button>` : ''}
        ${m.status === 'paga' && a ? `<button class="btn secundario" onclick="acoes.desfazerBaixa('${m.id}')">Desfazer baixa</button>` : ''}
        ${m.status === 'aberta' ? `<button class="btn secundario" onclick="acoes.formEditarMens('${m.id}')">Editar</button>` : ''}
        ${m.status === 'aberta' ? `<button class="btn perigo" onclick="acoes.cancelarMens('${m.id}')">Cancelar cobrança</button>` : ''}
        ${m.status === 'cancelada' ? `<button class="btn secundario" onclick="acoes.reabrirMens('${m.id}')">Reabrir</button>` : ''}
      </div>
      <div class="botoes"><button class="btn secundario" onclick="fecharModal()">Fechar</button></div>`);
  },

  formBaixa(id) {
    const m = mensPorId(id);
    const a = alunoPorId(m.alunoId);
    abrirModal(`
      <h3>Dar baixa</h3>
      <p class="detalhe">${esc(a ? a.nome : '')} · ${fmtComp(m.comp)}</p>
      <form class="campos" id="f-baixa">
        <label>Data do pagamento<input name="data" type="date" required value="${hoje()}"></label>
        <label>Valor pago (R$)<input name="valor" inputmode="decimal" required value="${numBR(m.valor)}"></label>
        <label>Forma
          <select name="forma"><option>Pix</option><option>Dinheiro</option><option>Cartão</option><option>Outro</option></select>
        </label>
        <div class="botoes">
          <button type="button" class="btn secundario" onclick="fecharModal()">Cancelar</button>
          <button type="submit" class="btn ok">Confirmar</button>
        </div>
      </form>`);
    document.getElementById('f-baixa').onsubmit = async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const v = lerValor(f.get('valor'));
      if (!Number.isFinite(v) || v <= 0) { avisar('Valor inválido.'); return; }
      Object.assign(m, { status: 'paga', dataPag: f.get('data'), valorPago: v, forma: f.get('forma') });
      await persistir();
      render();
      acoes.posBaixa(m.id);
    };
  },

  // Logo após a baixa: oferece o recibo.
  posBaixa(id) {
    const m = mensPorId(id);
    const a = alunoPorId(m.alunoId);
    const temWhats = a && numeroWhats(a.telefone);
    abrirModal(`
      <h3>✅ Baixa registrada</h3>
      <p class="detalhe">${esc(nomeDaMens(m))} · ${fmtComp(m.comp)} · ${brl(m.valorPago)} · ${esc(m.forma)}</p>
      <p>Quer enviar o recibo?</p>
      <div class="botoes">
        ${temWhats ? `<button class="btn whats" onclick="acoes.reciboWhats('${m.id}')">🧾 Enviar recibo no WhatsApp</button>` : ''}
        <button class="btn" onclick="acoes.recibo('${m.id}')">Ver recibo / PDF</button>
      </div>
      <div class="botoes"><button class="btn secundario" onclick="fecharModal()">Agora não</button></div>`);
  },

  async recibo(id) {
    const m = mensPorId(id);
    if (!m || m.status !== 'paga') return;
    await garantirNumero(m);
    const a = alunoPorId(m.alunoId);
    const temWhats = a && numeroWhats(a.telefone);
    const c = E.config;
    const faltam = !c.academia || !c.responsavel || !c.documento || !c.cidade;
    abrirModal(`
      <h3>Recibo nº ${numRecibo(m.recibo)}</h3>
      ${faltam ? '<p class="faixa-aviso">Complete os dados do recibo em <b>Ajustes &gt; Recibos</b> (academia, responsável, CNPJ/CPF e cidade).</p>' : ''}
      ${htmlRecibo(m)}
      <div class="botoes">
        ${temWhats ? `<button class="btn whats" onclick="acoes.reciboWhats('${m.id}')">WhatsApp</button>` : ''}
        <button class="btn" onclick="acoes.reciboPDF('${m.id}')">📄 Salvar PDF</button>
      </div>
      <div class="botoes"><button class="btn secundario" onclick="fecharModal()">Fechar</button></div>`);
  },

  async reciboWhats(id) {
    const m = mensPorId(id);
    const a = alunoPorId(m.alunoId);
    const num = a && numeroWhats(a.telefone);
    if (!num) { avisar('Telefone inválido. Edite o cadastro do aluno (DDD + número).'); return; }
    await garantirNumero(m);
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(textoReciboWhats(m))}`, '_blank');
    fecharModal();
    render();
  },

  async reciboPDF(id) {
    const m = mensPorId(id);
    await garantirNumero(m);
    let area = document.getElementById('area-recibo');
    if (!area) { area = document.createElement('div'); area.id = 'area-recibo'; document.body.appendChild(area); }
    area.innerHTML = htmlRecibo(m);
    fecharModal();
    document.body.classList.add('imprimindo-recibo');
    document.title = `Recibo ${numRecibo(m.recibo)} - ${nomeDaMens(m)}`;
    // No Android a impressão não bloqueia: a limpeza fica para o fim da impressão.
    window.addEventListener('afterprint', () => { document.body.classList.remove('imprimindo-recibo'); document.title = 'Mensalidades'; }, { once: true });
    window.print();
  },

  formEditarMens(id) {
    const m = mensPorId(id);
    abrirModal(`
      <h3>Editar mensalidade ${fmtComp(m.comp)}</h3>
      <form class="campos" id="f-mens">
        <label>Vencimento<input name="venc" type="date" required value="${m.venc}"></label>
        <label>Valor (R$)<input name="valor" inputmode="decimal" required value="${numBR(m.valor)}"></label>
        <div class="botoes">
          <button type="button" class="btn secundario" onclick="fecharModal()">Cancelar</button>
          <button type="submit" class="btn ok">Salvar</button>
        </div>
      </form>`);
    document.getElementById('f-mens').onsubmit = async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const v = lerValor(f.get('valor'));
      if (!Number.isFinite(v) || v < 0) { avisar('Valor inválido.'); return; }
      m.venc = f.get('venc');
      m.valor = v;
      await persistir();
      fecharModal();
      render();
    };
  },

  async desfazerBaixa(id) {
    const m = mensPorId(id);
    if (!alunoPorId(m.alunoId)) { avisar('Aluno excluído: a baixa não pode ser desfeita.'); return; }
    if (!confirm('Desfazer a baixa desta mensalidade?')) return;
    Object.assign(m, { status: 'aberta', dataPag: null, valorPago: null, forma: null });
    await persistir();
    fecharModal();
    avisar('Baixa desfeita.');
    render();
  },

  async cancelarMens(id) {
    if (!confirm('Cancelar esta cobrança (ex.: aluno saiu, férias, isento)?')) return;
    mensPorId(id).status = 'cancelada';
    await persistir();
    fecharModal();
    render();
  },

  async reabrirMens(id) {
    mensPorId(id).status = 'aberta';
    await persistir();
    fecharModal();
    render();
  },

  async gerarMesVisivel() {
    const n = gerarCompetencia(ui.comp);
    await persistir();
    avisar(`${n} mensalidade(s) gerada(s) para ${fmtComp(ui.comp)}.`);
    render();
  },

  // ---------- Ajustes ----------
  async salvarConfig(ev) {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const v = lerValor(f.get('valorPadrao'));
    const tol = parseInt(f.get('tolerancia'), 10);
    const sum = parseInt(f.get('diasSumido'), 10);
    if (!Number.isFinite(v) || v < 0) { avisar('Valor padrão inválido.'); return; }
    // O próximo número nunca pode repetir um recibo já emitido.
    const maiorEmitido = E.mensalidades.reduce((mx, m) => Math.max(mx, Number(m.recibo) || 0), 0);
    let prox = parseInt(f.get('proxRecibo'), 10);
    if (!Number.isFinite(prox) || prox < 1) prox = 1;
    if (prox <= maiorEmitido) { prox = maiorEmitido + 1; avisar(`O recibo nº ${numRecibo(maiorEmitido)} já foi emitido; o próximo será ${numRecibo(prox)}.`); }
    Object.assign(E.config, {
      responsavel: String(f.get('responsavel')).trim(),
      documento: String(f.get('documento')).trim(),
      cidade: String(f.get('cidade')).trim(),
      proxRecibo: prox,
      diasSumido: sum >= 15 && sum <= 365 ? sum : 60,
      academia: String(f.get('academia')).trim(),
      valorPadrao: v,
      tolerancia: Number.isFinite(tol) && tol >= 0 ? tol : 0,
      pix: String(f.get('pix')).trim(),
      msgLembrete: String(f.get('msgLembrete')).trim() || MSG_LEMBRETE,
      msgAtraso: String(f.get('msgAtraso')).trim() || MSG_ATRASO,
    });
    await persistir();
    avisar('Ajustes salvos.');
    render();
  },

  restaurarMensagens() {
    document.querySelector('[name=msgLembrete]').value = MSG_LEMBRETE;
    document.querySelector('[name=msgAtraso]').value = MSG_ATRASO;
    avisar('Modelos padrão restaurados. Toque em Salvar.');
  },

  async backup() {
    const nome = `backup-academia-${fmtData(hoje()).replace(/\//g, '-')}.json`;
    const conteudo = JSON.stringify({ app: 'mensalidades-academia', exportadoEm: new Date().toISOString(), estado: E }, null, 1);
    const arquivo = new File([conteudo], nome, { type: 'application/json' });
    let ok = false;
    if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
      try { await navigator.share({ files: [arquivo], title: 'Backup mensalidades' }); ok = true; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    if (!ok) { baixarArquivo(arquivo); ok = true; }
    E.ultimoBackup = hoje();
    await persistir();
    avisar('Backup gerado. Guarde o arquivo no Drive ou no seu WhatsApp.');
    render();
  },

  async restaurar(input) {
    const arq = input.files[0];
    input.value = '';
    if (!arq) return;
    try {
      const obj = JSON.parse(await arq.text());
      const est = obj.estado;
      if (obj.app !== 'mensalidades-academia' || !est || !Array.isArray(est.alunos) || !Array.isArray(est.mensalidades)) throw new Error('formato');
      if (!confirm(`Restaurar backup de ${fmtData(String(obj.exportadoEm).slice(0, 10))}?\n${est.alunos.length} alunos e ${est.mensalidades.length} mensalidades.\n\nOs dados atuais serão SUBSTITUÍDOS.`)) return;
      E = { ...estadoInicial(), ...est, config: { ...estadoInicial().config, ...est.config } };
      gerarPendentes();
      await persistir();
      avisar('Backup restaurado.');
      render();
    } catch {
      avisar('Arquivo inválido. Use um backup gerado por este app.');
    }
  },

  exportarCSV() {
    const mes = document.getElementById('csv-mes').value; // AAAA-MM ou vazio
    const pagas = E.mensalidades
      .filter((m) => m.status === 'paga' && (!mes || compDe(m.dataPag) === mes))
      .sort((x, y) => x.dataPag.localeCompare(y.dataPag));
    if (!pagas.length) { avisar('Nenhum pagamento no período.'); return; }
    const limpa = (s) => String(s || '').replace(/[;\r\n]/g, ' ');
    const linhas = ['data;historico;valor;conta;origem;id_extrato;observacao'];
    pagas.forEach((m) => {
      linhas.push([fmtData(m.dataPag), limpa(`Mensalidade ${fmtComp(m.comp)} - ${nomeDaMens(m)}`),
        numBR(m.valorPago), 'R01', 'app-academia', 'app-' + m.id.slice(0, 8), limpa(m.forma)].join(';'));
    });
    const nome = `recebimentos-app-${mes ? fmtComp(mes).replace('/', '-') : 'tudo'}.csv`;
    baixarArquivo(new File(['﻿' + linhas.join('\r\n') + '\r\n'], nome, { type: 'text/csv;charset=utf-8' }));
    avisar(`${pagas.length} pagamento(s) exportado(s).`);
  },

  async importarAlunos(input) {
    const arq = input.files[0];
    input.value = '';
    if (!arq) return;
    // Arquivo salvo pelo Excel vem em ANSI (windows-1252); os demais, em UTF-8.
    const bytes = await arq.arrayBuffer();
    let texto;
    try { texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { texto = new TextDecoder('windows-1252').decode(bytes); }
    texto = texto.replace(/^﻿/, '');
    const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^;*$/.test(l));
    if (linhas.length && /nome/i.test(linhas[0])) linhas.shift();
    let novos = 0, repetidos = 0;
    const existentes = new Set(E.alunos.map((a) => a.nome.toLowerCase()));
    linhas.forEach((l) => {
      const [nome, telefone, dia, valor, obs] = l.split(';').map((s) => (s || '').trim().replace(/^"|"$/g, ''));
      if (!nome) return;
      if (existentes.has(nome.toLowerCase())) { repetidos++; return; }
      const v = lerValor(valor);
      const d = parseInt(dia, 10);
      const a = {
        id: uid(), ativo: true, criadoEm: hoje(), matricula: hoje(), nome, telefone: telefone || '',
        diaVenc: d >= 1 && d <= 31 ? d : 10, valor: Number.isFinite(v) && v > 0 ? v : Number(E.config.valorPadrao), obs: obs || '',
      };
      E.alunos.push(a);
      existentes.add(nome.toLowerCase());
      gerarParaAluno(a, compAtual());
      novos++;
    });
    await persistir();
    avisar(`${novos} aluno(s) importado(s)${repetidos ? `, ${repetidos} já existia(m)` : ''}.`);
    render();
  },

  async apagarTudo() {
    if (!confirm('Apagar TODOS os alunos e pagamentos deste celular?')) return;
    if (prompt('Digite APAGAR para confirmar:') !== 'APAGAR') { avisar('Nada foi apagado.'); return; }
    E = estadoInicial();
    gerarPendentes();
    await persistir();
    avisar('Dados apagados.');
    render();
  },
};

function baixarArquivo(arquivo) {
  const url = URL.createObjectURL(arquivo);
  const a = document.createElement('a');
  a.href = url;
  a.download = arquivo.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ===================== Componentes =====================

function itemMensalidade(m, opc = {}) {
  const a = alunoPorId(m.alunoId);
  const s = situacao(m);
  let det = `Vence ${fmtData(m.venc)} · ${brl(m.valor)}`;
  if (m.status === 'paga') det = `Pago ${fmtDiaMes(m.dataPag)} · ${brl(m.valorPago)} · ${esc(m.forma)}`;
  if (s === 'atrasada') det += ` · ${diasAtraso(m)}d`;
  const titulo = opc.semNome ? `${fmtComp(m.comp)}` : esc(nomeDaMens(m));
  const acao = m.status === 'aberta'
    ? `<button class="btn ok pequeno" onclick="event.stopPropagation();acoes.formBaixa('${m.id}')">Baixa</button>`
    : '';
  return `
    <div class="item clicavel" onclick="acoes.detalheMens('${m.id}')">
      <div class="info">
        <div class="nome">${titulo}</div>
        <div class="detalhe"><span class="etiqueta ${s}">${ROTULO[s]}</span> ${det}</div>
      </div>
      <div class="acoes">${acao}</div>
    </div>`;
}

function cartao(rotulo, valor, sub = '', classe = '') {
  return `<div class="cartao ${classe}"><div class="rotulo">${rotulo}</div><div class="valor">${valor}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
}

// ===================== Telas =====================

function telaPainel() {
  const h = hoje();
  const comp = compAtual();
  const recebidoMes = recebidoEntre(`${comp}-01`, `${comp}-31`);
  const totRecebido = recebidoMes.reduce((s, m) => s + Number(m.valorPago), 0);
  const doMes = E.mensalidades.filter((m) => m.comp === comp);
  const aReceber = doMes.filter((m) => situacao(m) === 'aberta');
  const atrasadas = E.mensalidades.filter((m) => situacao(m) === 'atrasada');
  const alunosAtraso = new Set(atrasadas.map((m) => m.alunoId)).size;
  const ativos = E.alunos.filter((a) => a.ativo).length;

  const ano = h.slice(0, 4);
  const totAno = recebidoEntre(`${ano}-01-01`, `${ano}-12-31`).reduce((s, m) => s + Number(m.valorPago), 0);
  const teto = Number(E.config.tetoMei) || 81000;
  const pct = Math.min(100, (totAno / teto) * 100);
  const classeTeto = pct >= 100 ? 'estourou' : pct >= 80 ? 'perto' : '';

  const proximas = E.mensalidades
    .filter((m) => m.status === 'aberta' && m.venc >= h && m.venc <= somarDias(h, 7))
    .sort((x, y) => x.venc.localeCompare(y.venc));

  const semBackup = !E.ultimoBackup || diasEntre(E.ultimoBackup, h) >= 7;

  return `
    ${semBackup && E.alunos.length ? `<div class="faixa-aviso"><span>${E.ultimoBackup ? `Último backup em ${fmtData(E.ultimoBackup)}.` : 'Você ainda não fez backup.'} Os dados ficam só neste celular.</span><button class="btn pequeno" onclick="acoes.backup()">Backup</button></div>` : ''}
    ${!E.alunos.length ? `<div class="cartao largo"><b>Comece cadastrando seus alunos.</b><p class="detalhe">Toque em "+ Aluno" no topo, ou importe uma lista em Ajustes.</p></div>` : ''}
    <div class="cartoes">
      ${cartao('Recebido no mês', brl(totRecebido), `${recebidoMes.length} pagamento(s)`, 'ok')}
      ${cartao('A receber no mês', brl(aReceber.reduce((s, m) => s + Number(m.valor), 0)), `${aReceber.length} em aberto, no prazo`)}
      ${cartao('Em atraso', brl(atrasadas.reduce((s, m) => s + Number(m.valor), 0)), `${alunosAtraso} aluno(s)`, atrasadas.length ? 'alerta' : '')}
      ${cartao('Alunos ativos', String(ativos), `${E.alunos.length - ativos} inativo(s)`)}
      <div class="cartao largo">
        <div class="rotulo">Recebido em ${ano} (pelo app) x teto do MEI</div>
        <div class="valor">${brl(totAno)}</div>
        <div class="sub">${pct.toFixed(1).replace('.', ',')}% de ${brl(teto)}</div>
        <div class="barra-teto ${classeTeto}"><div style="width:${pct}%"></div></div>
      </div>
    </div>
    <h2>Vencem nos próximos 7 dias</h2>
    <div class="lista">
      ${proximas.length ? proximas.map((m) => {
        const a = alunoPorId(m.alunoId);
        return `
        <div class="item">
          <div class="info clicavel" onclick="acoes.detalheMens('${m.id}')">
            <div class="nome">${esc(a.nome)}</div>
            <div class="detalhe">${m.venc === h ? '<b>Vence hoje</b>' : 'Vence ' + fmtData(m.venc)} · ${brl(m.valor)}${m.ultimoAviso ? ' · lembrado ' + fmtDiaMes(m.ultimoAviso) : ''}</div>
          </div>
          <div class="acoes">
            <button class="btn whats pequeno" onclick="enviarWhats('${a.id}','lembrete',['${m.id}'])">Lembrar</button>
            <button class="btn ok pequeno" onclick="acoes.formBaixa('${m.id}')">Baixa</button>
          </div>
        </div>`;
      }).join('') : '<div class="vazio">Nenhum vencimento nos próximos 7 dias.</div>'}
    </div>`;
}

function telaMes() {
  const comp = ui.comp;
  const doMes = E.mensalidades.filter((m) => m.comp === comp);
  const naoGerado = !E.config.ultimaCompGerada || comp > E.config.ultimaCompGerada;
  const filtrar = {
    todas: () => true,
    abertas: (m) => situacao(m) === 'aberta',
    atrasadas: (m) => situacao(m) === 'atrasada',
    pagas: (m) => m.status === 'paga',
    canceladas: (m) => m.status === 'cancelada',
  }[ui.filtroMes];
  const lista = doMes.filter(filtrar).sort((x, y) => x.venc.localeCompare(y.venc) || (alunoPorId(x.alunoId)?.nome || '').localeCompare(alunoPorId(y.alunoId)?.nome || ''));
  const validas = doMes.filter((m) => m.status !== 'cancelada');
  const previsto = validas.reduce((s, m) => s + Number(m.valor), 0);
  const pagas = validas.filter((m) => m.status === 'paga');
  const recebido = pagas.reduce((s, m) => s + Number(m.valorPago), 0);
  const emAberto = validas.filter((m) => m.status === 'aberta').reduce((s, m) => s + Number(m.valor), 0);
  const botaoFiltro = (k, r) => `<button class="${ui.filtroMes === k ? 'ativo' : ''}" onclick="ui.filtroMes='${k}';render()">${r}</button>`;

  return `
    <div class="navmes">
      <button class="btn secundario pequeno" onclick="ui.comp=somarComp(ui.comp,-1);render()">◀</button>
      <strong>${nomeMes(comp)}</strong>
      <button class="btn secundario pequeno" onclick="ui.comp=somarComp(ui.comp,1);render()">▶</button>
    </div>
    <div class="cartoes">
      ${cartao('Previsto', brl(previsto), `${validas.length} mensalidade(s)`)}
      ${cartao('Recebido', brl(recebido), `${pagas.length} paga(s)`, 'ok')}
      ${cartao('Em aberto', brl(emAberto), '', emAberto ? 'alerta' : '', )}
      ${cartao('Adimplência', previsto ? ((recebido / previsto) * 100).toFixed(0) + '%' : '-', 'recebido / previsto')}
    </div>
    ${naoGerado ? `<div class="faixa-aviso"><span>As mensalidades de ${fmtComp(comp)} ainda não foram geradas.</span><button class="btn pequeno" onclick="acoes.gerarMesVisivel()">Gerar</button></div>` : ''}
    <div class="filtros">
      ${botaoFiltro('todas', 'Todas')}${botaoFiltro('abertas', 'No prazo')}${botaoFiltro('atrasadas', 'Atrasadas')}${botaoFiltro('pagas', 'Pagas')}${botaoFiltro('canceladas', 'Canceladas')}
    </div>
    <div class="lista">${lista.length ? lista.map((m) => itemMensalidade(m)).join('') : '<div class="vazio">Nada por aqui.</div>'}</div>`;
}

function telaAtrasados() {
  const porAluno = new Map();
  E.mensalidades.filter((m) => situacao(m) === 'atrasada').forEach((m) => {
    if (!porAluno.has(m.alunoId)) porAluno.set(m.alunoId, []);
    porAluno.get(m.alunoId).push(m);
  });
  const grupos = [...porAluno.entries()]
    .map(([id, ms]) => ({ a: alunoPorId(id), ms: ms.sort((x, y) => x.comp.localeCompare(y.comp)) }))
    .filter((g) => g.a)
    .sort((x, y) => diasAtraso(y.ms[0]) - diasAtraso(x.ms[0]));
  const total = grupos.reduce((s, g) => s + g.ms.reduce((t, m) => t + Number(m.valor), 0), 0);
  const h = hoje();

  return `
    <div class="cartoes">
      ${cartao('Total em atraso', brl(total), '', total ? 'alerta' : 'ok')}
      ${cartao('Alunos', String(grupos.length), `tolerância de ${E.config.tolerancia} dia(s)`)}
    </div>
    <div class="lista">
      ${grupos.length ? grupos.map(({ a, ms }) => {
        const tot = ms.reduce((s, m) => s + Number(m.valor), 0);
        const avisos = ms.map((m) => m.ultimoAviso).filter(Boolean).sort();
        const ultimo = avisos[avisos.length - 1];
        return `
        <div class="item">
          <div class="info clicavel" onclick="acoes.fichaAluno('${a.id}')">
            <div class="nome">${esc(a.nome)}</div>
            <div class="detalhe">${ms.map((m) => fmtComp(m.comp)).join(', ')} · <b>${brl(tot)}</b> · ${diasAtraso(ms[0])} dias</div>
            <div class="detalhe">${ultimo ? (ultimo === h ? '✅ Avisado hoje' : 'Avisado em ' + fmtData(ultimo)) : 'Ainda não avisado'}</div>
          </div>
          <div class="acoes">
            <button class="btn whats pequeno" onclick='enviarWhats("${a.id}","atraso",${JSON.stringify(ms.map((m) => m.id))})'>WhatsApp</button>
          </div>
        </div>`;
      }).join('') : '<div class="vazio">🥋 Ninguém em atraso. Oss!</div>'}
    </div>
    <p class="ajuda">Toque no nome para ver a ficha e dar baixa. O botão WhatsApp abre a conversa com a mensagem pronta; você só aperta enviar.</p>`;
}

function telaAlunos() {
  const termo = ui.busca.trim().toLowerCase();
  const sumidos = ui.filtroAlunos === 'sumidos';
  const lista = E.alunos
    .filter((a) => (sumidos ? ehSumido(a) : ui.filtroAlunos === 'todos' || (ui.filtroAlunos === 'ativos') === a.ativo))
    .filter((a) => !termo || a.nome.toLowerCase().includes(termo) || String(a.telefone).includes(termo))
    .sort((x, y) => (sumidos ? diasSemPagar(y) - diasSemPagar(x) : x.nome.localeCompare(y.nome, 'pt-BR')));
  const qtdSumidos = E.alunos.filter(ehSumido).length;
  const botaoFiltro = (k, r) => `<button class="${ui.filtroAlunos === k ? 'ativo' : ''}" onclick="ui.filtroAlunos='${k}';render()">${r}</button>`;
  return `
    <input class="busca" type="search" placeholder="Buscar por nome ou telefone" value="${esc(ui.busca)}" oninput="ui.busca=this.value;atualizarListaAlunos()">
    <div class="filtros">${botaoFiltro('ativos', 'Ativos')}${botaoFiltro('sumidos', `Sumidos${qtdSumidos ? ` (${qtdSumidos})` : ''}`)}${botaoFiltro('inativos', 'Inativos')}${botaoFiltro('todos', 'Todos')}</div>
    ${sumidos ? `<p class="ajuda">Alunos ativos sem nenhum pagamento há ${Number(E.config.diasSumido) || 60} dias ou mais (sem pagamento, conta da matrícula). Abra a ficha para cobrar ou inativar. O prazo muda em Ajustes.</p>` : ''}
    <div class="lista" id="lista-alunos">${lista.length ? lista.map((a) => {
      const atr = atrasadasDoAluno(a.id);
      const saida = saidaAtual(a);
      const etq = !a.ativo ? `<span class="etiqueta cancelada">Inativo${saida ? ' desde ' + fmtData(saida.data) : ''}</span>`
        : atr.length ? `<span class="etiqueta atrasada">${atr.length} atrasada(s)</span>` : '<span class="etiqueta paga">Em dia</span>';
      const ultPag = ultimoPagamento(a.id);
      const det = sumidos
        ? `${etq} ${diasSemPagar(a)} dias sem pagar · último: ${ultPag ? fmtData(ultPag) : 'nenhum'}`
        : `${etq} Dia ${a.diaVenc} · ${brl(a.valor)}`;
      return `
        <div class="item clicavel ${a.ativo ? '' : 'inativo'}" onclick="acoes.fichaAluno('${a.id}')">
          <div class="info">
            <div class="nome">${esc(a.nome)}</div>
            <div class="detalhe">${det}</div>
          </div>
        </div>`;
    }).join('') : `<div class="vazio">${sumidos ? 'Nenhum aluno sumido.' : 'Nenhum aluno encontrado.'}</div>`}</div>`;
}

// Atualiza só a lista ao digitar, para não perder o foco do campo de busca.
function atualizarListaAlunos() {
  const tmp = document.createElement('div');
  tmp.innerHTML = telaAlunos();
  document.getElementById('lista-alunos').replaceWith(tmp.querySelector('#lista-alunos'));
}

function telaRelatorios() {
  const ano = ui.anoRel;
  const meses = Array.from({ length: 12 }, (_, i) => `${ano}-${pad(i + 1)}`);
  const pagasAno = recebidoEntre(`${ano}-01-01`, `${ano}-12-31`);
  const porMes = meses.map((c) => {
    const ps = pagasAno.filter((m) => compDe(m.dataPag) === c);
    return { c, n: ps.length, v: ps.reduce((s, m) => s + Number(m.valorPago), 0) };
  });
  const max = Math.max(1, ...porMes.map((x) => x.v));
  const totAno = porMes.reduce((s, x) => s + x.v, 0);
  const porForma = {};
  pagasAno.forEach((m) => { porForma[m.forma] = (porForma[m.forma] || 0) + Number(m.valorPago); });

  const comp = compAtual();
  const doMes = E.mensalidades.filter((m) => m.comp === comp && m.status !== 'cancelada');
  const prev = doMes.reduce((s, m) => s + Number(m.valor), 0);
  const atr = doMes.filter((m) => situacao(m) === 'atrasada').reduce((s, m) => s + Number(m.valor), 0);
  const atrGeral = E.mensalidades.filter((m) => situacao(m) === 'atrasada').reduce((s, m) => s + Number(m.valor), 0);

  // Churn: saídas do mês / alunos ativos no fim do mês anterior.
  const todasSaidas = E.alunos.flatMap((a) => (a.saidas || []).map((s) => ({ ...s, alunoId: a.id })));
  const saidasAno = todasSaidas.filter((s) => s.data.startsWith(String(ano)));
  const churn = meses.filter((c) => c <= comp).map((c) => {
    const vespera = somarDias(`${c}-01`, -1);
    const base = E.alunos.filter((a) => ativoEm(a, vespera) === true).length;
    const entradas = E.alunos.filter((a) => compDe(a.matricula || a.criadoEm) === c).length;
    const saidas = saidasAno.filter((s) => compDe(s.data) === c).length;
    return { c, base, entradas, saidas, pct: base ? (saidas / base) * 100 : null };
  });
  const porMotivo = {};
  saidasAno.forEach((s) => { porMotivo[s.motivo] = (porMotivo[s.motivo] || 0) + 1; });
  const semRegistro = E.alunos.filter((a) => !a.ativo && !(a.saidas || []).length).length;
  const pctBR = (v) => (v === null ? '-' : v.toFixed(1).replace('.', ',') + '%');

  return `
    <div class="navmes">
      <button class="btn secundario pequeno" onclick="ui.anoRel--;render()">◀</button>
      <strong>Entradas de ${ano}</strong>
      <button class="btn secundario pequeno" onclick="ui.anoRel++;render()">▶</button>
    </div>
    <div class="grafico">${porMes.map((x) => `<div class="col" title="${brl(x.v)}"><div style="height:${(x.v / max) * 100}%"></div><small>${mesCurto(x.c)}</small></div>`).join('')}</div>
    <table class="tabela">
      <thead><tr><th>Mês</th><th class="num">Pagtos</th><th class="num">Recebido</th></tr></thead>
      <tbody>
        ${porMes.map((x) => `<tr><td>${fmtComp(x.c)}</td><td class="num">${x.n}</td><td class="num">${brl(x.v)}</td></tr>`).join('')}
        <tr><td><b>Total</b></td><td class="num"><b>${pagasAno.length}</b></td><td class="num"><b>${brl(totAno)}</b></td></tr>
      </tbody>
    </table>
    <p class="ajuda">Regime de caixa: conta pela data em que o pagamento foi recebido.</p>

    <h2>Por forma de pagamento (${ano})</h2>
    <table class="tabela"><tbody>
      ${Object.keys(porForma).length ? Object.entries(porForma).sort((x, y) => y[1] - x[1]).map(([f, v]) => `<tr><td>${esc(f)}</td><td class="num">${brl(v)}</td><td class="num">${((v / totAno) * 100).toFixed(1).replace('.', ',')}%</td></tr>`).join('') : '<tr><td>Sem pagamentos.</td></tr>'}
    </tbody></table>

    <h2>Inadimplência</h2>
    <table class="tabela"><tbody>
      <tr><td>Previsto em ${fmtComp(comp)}</td><td class="num">${brl(prev)}</td></tr>
      <tr><td>Atrasado de ${fmtComp(comp)}</td><td class="num">${brl(atr)}</td></tr>
      <tr><td>Inadimplência do mês</td><td class="num"><b>${prev ? ((atr / prev) * 100).toFixed(1).replace('.', ',') + '%' : '-'}</b></td></tr>
      <tr><td>Atraso acumulado (todos os meses)</td><td class="num"><b>${brl(atrGeral)}</b></td></tr>
    </tbody></table>

    <h2>Entradas e saídas de alunos (${ano})</h2>
    ${churn.length ? `<table class="tabela">
      <thead><tr><th>Mês</th><th class="num">Base</th><th class="num">Entraram</th><th class="num">Saíram</th><th class="num">Churn</th></tr></thead>
      <tbody>
        ${churn.map((x) => `<tr><td>${fmtComp(x.c)}</td><td class="num">${x.base}</td><td class="num">${x.entradas}</td><td class="num">${x.saidas}</td><td class="num">${pctBR(x.pct)}</td></tr>`).join('')}
        <tr><td><b>Total</b></td><td class="num"></td><td class="num"><b>${churn.reduce((s, x) => s + x.entradas, 0)}</b></td><td class="num"><b>${saidasAno.length}</b></td><td class="num"></td></tr>
      </tbody>
    </table>` : '<div class="vazio">Ano futuro.</div>'}
    <p class="ajuda">Base = alunos ativos no fim do mês anterior. Churn = saíram no mês ÷ base. Entraram = matrículas no mês.${semRegistro ? ` ${semRegistro} aluno(s) inativado(s) antes desta versão não têm data de saída e ficam fora da conta.` : ''}</p>

    <h2>Motivos de saída (${ano})</h2>
    <table class="tabela"><tbody>
      ${saidasAno.length ? Object.entries(porMotivo).sort((x, y) => y[1] - x[1]).map(([m, n]) => `<tr><td>${esc(m)}</td><td class="num">${n}</td><td class="num">${pctBR((n / saidasAno.length) * 100)}</td></tr>`).join('') : '<tr><td>Nenhuma saída registrada.</td></tr>'}
    </tbody></table>`;
}

function telaConfig() {
  const c = E.config;
  return `
    <form class="campos cartao" onsubmit="acoes.salvarConfig(event)">
      <label>Nome da academia<input name="academia" value="${esc(c.academia)}"></label>
      <div class="linha">
        <label>Mensalidade padrão (R$)<input name="valorPadrao" inputmode="decimal" value="${numBR(c.valorPadrao)}"></label>
        <label>Tolerância (dias)<input name="tolerancia" type="number" min="0" max="31" value="${esc(c.tolerancia)}"></label>
      </div>
      <label>Considerar "sumido" após (dias sem pagar)<input name="diasSumido" type="number" min="15" max="365" value="${esc(c.diasSumido)}"></label>
      <label>Chave Pix<input name="pix" value="${esc(c.pix)}" placeholder="CNPJ, e-mail, telefone..."></label>
      <h3 style="margin:8px 0 0">🧾 Recibos</h3>
      <label>Responsável (quem assina)<input name="responsavel" value="${esc(c.responsavel)}" placeholder="Ex.: Michel Ebertz"></label>
      <label>CNPJ do MEI (ou CPF)<input name="documento" inputmode="numeric" value="${esc(c.documento)}" placeholder="00.000.000/0001-00"></label>
      <div class="linha">
        <label>Cidade/UF<input name="cidade" value="${esc(c.cidade)}" placeholder="Chapecó/SC"></label>
        <label>Próximo nº de recibo<input name="proxRecibo" type="number" min="1" value="${esc(c.proxRecibo)}"></label>
      </div>
      <label>Mensagem de lembrete (antes do vencimento)<textarea name="msgLembrete">${esc(c.msgLembrete)}</textarea></label>
      <label>Mensagem de atraso<textarea name="msgAtraso">${esc(c.msgAtraso)}</textarea></label>
      <p class="ajuda">Variáveis: {nome} {nome_completo} {competencia} {valor} {vencimento} {dias} {pix} {academia}</p>
      <div class="botoes">
        <button type="button" class="btn secundario" onclick="acoes.restaurarMensagens()">Mensagens padrão</button>
        <button type="submit" class="btn ok">Salvar</button>
      </div>
    </form>

    <h2>Backup</h2>
    <div class="cartao">
      <p class="detalhe" style="margin-top:0">Os dados ficam só neste celular. Faça backup toda semana e guarde o arquivo no Google Drive ou no seu WhatsApp.<br>
      Último backup: <b>${E.ultimoBackup ? fmtData(E.ultimoBackup) : 'nunca'}</b></p>
      <div class="botoes">
        <button class="btn" onclick="acoes.backup()">Fazer backup</button>
        <button class="btn secundario" onclick="document.getElementById('in-restaurar').click()">Restaurar</button>
      </div>
      <input id="in-restaurar" type="file" accept=".json,application/json" hidden onchange="acoes.restaurar(this)">
    </div>

    <h2>Exportar para o financeiro</h2>
    <div class="cartao">
      <p class="detalhe" style="margin-top:0">CSV no formato da base do financeiro da academia (conta R01). Deixe o mês vazio para exportar tudo.</p>
      <form class="campos" onsubmit="event.preventDefault();acoes.exportarCSV()">
        <label>Mês do pagamento<input id="csv-mes" type="month" value="${compAtual()}"></label>
        <button class="btn" type="submit">Exportar CSV</button>
      </form>
    </div>

    <h2>Importar alunos</h2>
    <div class="cartao">
      <p class="detalhe" style="margin-top:0">Arquivo CSV com uma linha por aluno: <code>nome;telefone;dia_vencimento;valor;observacao</code> (pode ser editado no Excel). Nomes já cadastrados são ignorados.</p>
      <button class="btn secundario cheio" onclick="document.getElementById('in-importar').click()">Escolher arquivo</button>
      <input id="in-importar" type="file" accept=".csv,text/csv,text/plain" hidden onchange="acoes.importarAlunos(this)">
    </div>

    <h2>Zona de perigo</h2>
    <button class="btn perigo cheio" onclick="acoes.apagarTudo()">Apagar todos os dados</button>
    <p class="ajuda">Mensalidades da Academia · v6 · dados locais (IndexedDB)</p>`;
}

// ===================== Navegação =====================

const TELAS = {
  painel: ['Painel', telaPainel],
  mes: ['Mensalidades', telaMes],
  atrasados: ['Atrasados', telaAtrasados],
  alunos: ['Alunos', telaAlunos],
  relatorios: ['Relatórios', telaRelatorios],
  config: ['Ajustes', telaConfig],
};

function render() {
  const [titulo, fn] = TELAS[ui.aba];
  document.getElementById('titulo').textContent = titulo;
  document.getElementById('conteudo').innerHTML = fn();
  document.querySelectorAll('.abas button').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === ui.aba));
  const alunosAtraso = new Set(E.mensalidades.filter((m) => situacao(m) === 'atrasada').map((m) => m.alunoId)).size;
  const badge = document.getElementById('badge-atrasos');
  badge.hidden = !alunosAtraso;
  badge.textContent = alunosAtraso;
}

document.querySelectorAll('.abas button').forEach((b) => {
  b.addEventListener('click', () => { ui.aba = b.dataset.aba; window.scrollTo(0, 0); render(); });
});
document.getElementById('btn-novo-aluno').addEventListener('click', () => acoes.formAluno());

// Ao voltar para o app (ex.: depois do WhatsApp), recalcula datas e gera meses novos.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  if (gerarPendentes()) await persistir();
  if (!modal.open) render();
});

async function iniciar() {
  try {
    const salvo = await carregarEstado();
    if (salvo) E = { ...estadoInicial(), ...salvo, config: { ...estadoInicial().config, ...salvo.config } };
  } catch (e) {
    avisar('Erro ao abrir os dados: ' + e.message);
  }
  if (gerarPendentes()) await persistir();
  else if (!E.config.ultimaCompGerada) await persistir();
  render();
  pedirArmazenamentoPersistente();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

iniciar();
