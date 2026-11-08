// Armazenamento local no celular (IndexedDB).
// Todo o estado do app fica num único registro: a base é pequena
// (dezenas de alunos, algumas centenas de mensalidades por ano).

const DB_NOME = 'mensalidades-academia';
const DB_STORE = 'kv';
const CHAVE_ESTADO = 'estado';

function abrirBanco() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function carregarEstado() {
  const db = await abrirBanco();
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(CHAVE_ESTADO);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function salvarEstado(estado) {
  const db = await abrirBanco();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(estado, CHAVE_ESTADO);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Pede ao Chrome para não apagar os dados quando faltar espaço.
async function pedirArmazenamentoPersistente() {
  if (navigator.storage && navigator.storage.persist) {
    try { return await navigator.storage.persist(); } catch { return false; }
  }
  return false;
}

// PIN de acesso: guardado à parte, fora do estado, para nunca ir para os backups.
const CHAVE_ACESSO = 'acesso';

async function carregarAcesso() {
  const db = await abrirBanco();
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(CHAVE_ACESSO);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function salvarAcesso(acesso) {
  const db = await abrirBanco();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(acesso, CHAVE_ACESSO);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
