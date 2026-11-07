# Mensalidades da Academia (app para Android)

App simples para controlar alunos e mensalidades da academia. Funciona offline, e os dados ficam **só no celular**.

## O que ele faz
| Tela | Para quê |
|---|---|
| **Painel** | Recebido no mês, a receber, em atraso, alunos ativos, acumulado do ano x teto do MEI (R$ 81.000,00) e quem vence nos próximos 7 dias (com botão de lembrete) |
| **Mês** | Mensalidades do mês, filtros (no prazo, atrasadas, pagas, canceladas) e botão **Baixa** |
| **Atrasos** | Quem está devendo, há quantos dias, quanto, e o botão **WhatsApp** com a cobrança pronta |
| **Alunos** | Cadastro, busca, ficha com histórico e último pagamento, inativar (com data e motivo da saída) e reativar. Filtro **Sumidos**: ativos sem pagar há 60 dias ou mais |
| **Relatórios** | Entradas mês a mês, por forma de pagamento, inadimplência, entradas e saídas de alunos (churn) e motivos de saída |
| **Ajustes** | Valor padrão, tolerância, prazo de "sumido", chave Pix, textos das mensagens, backup, exportar CSV e importar alunos |

## Regras
- Ao abrir o app, as mensalidades do mês são criadas sozinhas para todos os alunos ativos, sem duplicar. Se o app ficar um mês sem ser aberto, ele cria o mês que faltou.
- Vencimento no dia 31 em mês curto vai para o último dia do mês.
- **Atrasada** = em aberto e passou do vencimento mais a tolerância (padrão: 3 dias).
- Mudar o valor ou o dia de vencimento do aluno vale para as mensalidades em aberto do mês atual em diante.
- Aluno inativado não gera mensalidades novas. Ao inativar, o app pede a **data e o motivo da saída** e oferece cancelar as mensalidades em aberto que vencem depois da saída. As vencidas até a saída continuam em aberto, como dívida.
- Ao reativar, o app registra a data de retorno. O histórico de saídas fica guardado.
- **Sumido** = aluno ativo sem nenhum pagamento há 60 dias ou mais (sem pagamento nenhum, conta da matrícula). O prazo muda em Ajustes. É um sinal pelo pagamento: o app não controla presença.
- **Churn do mês** = alunos que saíram no mês ÷ alunos ativos no fim do mês anterior. Alunos inativados antes da versão 2 não têm data de saída e ficam fora dessa conta.
- Os relatórios usam **regime de caixa**, ou seja, contam pela data do pagamento.
- **Excluir aluno** (desde a versão 3) apaga o cadastro e as mensalidades em aberto ou canceladas, mas **mantém os pagamentos recebidos**, com o nome do aluno gravado. Assim, relatórios, teto do MEI e CSV continuam batendo com o extrato. Esses pagamentos não podem ter a baixa desfeita. As saídas do aluno excluído deixam de contar no churn, por isso, para quem saiu, prefira **Inativar**.

## Como publicar (GitHub Pages, grátis)
Feito uma vez só, pelo navegador do computador. Não precisa instalar nada.
1. Crie uma conta em https://github.com/signup.
2. Clique em **+** (canto superior direito) > **New repository**. Nome: `mensalidades`. Marque **Public** e clique em **Create repository**.
3. Na página do repositório, clique em **uploading an existing file**. Arraste **todo o conteúdo** da pasta `app-academia` (arquivos e a pasta `icons`) e clique em **Commit changes**.
4. Vá em **Settings** > **Pages**. Em *Source*, escolha **Deploy from a branch**, selecione **main** e **/(root)** e clique em **Save**.
5. Depois de 1 a 2 minutos, o endereço aparece no topo da página: `https://SEU-USUARIO.github.io/mensalidades/`.

Só o código fica público. Os nomes e pagamentos dos alunos ficam no celular e nunca vão para o GitHub. Por isso, **não coloque** a lista de alunos (`alunos-importar.csv`) nem backups nessa pasta.

Para atualizar o app depois: aumente `VERSAO` em `sw.js` e envie os arquivos alterados do mesmo jeito (passo 3).

## Como instalar no celular
O app precisa estar num endereço **https** para poder ser instalado. Só o código fica online; os dados dos alunos nunca saem do celular.

1. Abra o endereço do app no **Chrome** do Android.
2. Toque no menu **⋮** e em **Instalar app** (ou **Adicionar à tela inicial**).
3. O ícone da faixa preta aparece na tela inicial. A partir daí, ele abre como um app e funciona sem internet.

## Backup (importante)
Os dados ficam no armazenamento do Chrome no celular. Se você trocar de celular, limpar os dados do Chrome ou desinstalar o app, **perde tudo**, a menos que tenha backup.

- **Ajustes > Fazer backup**, uma vez por semana. O app avisa no Painel quando passa de 7 dias.
- Envie o arquivo `backup-academia-DD-MM-AAAA.json` para o Google Drive ou para o seu próprio WhatsApp.
- Para recuperar: **Ajustes > Restaurar** e escolha o arquivo. Os dados atuais são substituídos.
- Nunca use "Limpar dados do site" no Chrome para o endereço do app.

## Importar alunos de uma vez
Em **Ajustes > Importar alunos**, escolha um arquivo `.csv` com uma linha por aluno:
```
nome;telefone;dia_vencimento;valor;observacao
João da Silva;49 99999-0000;10;170,00;Faixa azul
```
A coluna de observação é opcional. O arquivo pode ser editado e salvo no Excel (CSV separado por ponto e vírgula). Nomes já cadastrados são ignorados.

## Exportar para o financeiro
**Ajustes > Exportar CSV** gera os recebimentos no mesmo formato de `financeiro-academia\base\lancamentos.csv` (conta R01). Serve para conferir o app contra o extrato da conta XP no fechamento do mês.

## Mensagens
Em **Ajustes**, dá para editar os textos. Variáveis disponíveis:
`{nome}` (primeiro nome), `{nome_completo}`, `{competencia}`, `{valor}`, `{vencimento}`, `{dias}` (dias de atraso), `{pix}`, `{academia}`.

Quando o aluno tem mais de um mês atrasado, a mensagem junta tudo: competências, valor total e o vencimento mais antigo.

## Arquivos
| Arquivo | Conteúdo |
|---|---|
| `index.html` | Estrutura das telas |
| `styles.css` | Visual (claro e escuro, de acordo com o celular) |
| `app.js` | Regras e telas |
| `db.js` | Gravação dos dados no celular (IndexedDB) |
| `sw.js` | Funcionamento offline. **Ao alterar qualquer arquivo, aumente `VERSAO`** para os celulares baixarem a versão nova |
| `manifest.json` | Nome e ícone para instalar |
| `icons\` | Ícones 192 e 512 px |

## Testar no computador
Na pasta do app, rode `python -m http.server 8765` e abra `http://localhost:8765` no Chrome. Use F12 e o modo celular para ver como no telefone.
