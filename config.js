// ---------------------------------------------------------------
// 1) Lista de artigos (ficheiro CSV)
// Por defeito é o ficheiro "artigos.csv" que está ao lado da app (mesma pasta no GitHub).
// A app descarrega-o sozinha sempre que abre com internet e guarda uma cópia para funcionar offline.
// Colunas esperadas (por esta ordem ou com estes nomes):
//   Código de barras, Código artigo, Descrição do artigo, Preço 1
var LISTA_URL = 'artigos.csv';

// ---------------------------------------------------------------
// 2) Envio do ficheiro .plt por email
// Cola aqui o endereço da "Aplicação Web" do Apps Script (Codigo_Envio.gs), que acaba em /exec,
// e a mesma palavra-passe (CHAVE) que escreveste nesse script.
// Se ficar vazio, o botão "Enviar por email" avisa que não está configurado
// (os botões Partilhar e Transferir funcionam sempre).
var ENVIO_URL = '';
var ENVIO_CHAVE = '';
