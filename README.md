# Taekwondo Scoreboard

Aplicação web para controlo e visualização de pontuação de Taekwondo, com suporte para controlo remoto através de um dispositivo móvel utilizando um novo layout otimizado.

---

## 📦 Pré-requisitos

Antes de começar, garante que tens instalado:

* [Node.js](https://nodejs.org/) (versão recomendada: LTS)
* npm (incluído com o Node.js)

---

## 🚀 Instalação e Execução

Antes de iniciar, confirma se o **Node.js** já está instalado executando no terminal:

```bash
node -v
```

Se for apresentada uma versão (ex: `v18.x.x`), o Node.js está corretamente instalado.

Segue os passos abaixo para executar o projeto localmente:

### 1️⃣ Clonar o repositório

```bash
git clone <https://github.com/Miguelteixeira04/Taekwondo-Scoreboard.git>
cd Taekwondo-Scoreboard
```

### 2️⃣ Instalar as dependências

```bash
npm install
```

### 3️⃣ Iniciar o servidor

```bash
npm start
```

---

## 🌐 Acesso à Aplicação

Após iniciar o servidor:

* A aplicação principal será aberta automaticamente ou estará disponível em:

  👉 **[http://localhost:3000/](http://localhost:3000/)**

---

## 📱 Acesso Remoto (Telemóvel)

Para controlar o placar a partir de um telemóvel:

### 4️⃣ Obter o IP do computador

No **Windows**, abre a linha de comandos e executa:

```bash
ipconfig
```

Identifica o **IPv4 Address** da tua rede.

### 5️⃣ Aceder no telemóvel

No navegador do telemóvel (ligado à mesma rede Wi-Fi), abre:

```
http://IP:3000/remote.html
```

(Substitui `IP` pelo endereço IPv4 do computador)

---

## ✅ Notas Importantes

* O computador e o telemóvel devem estar ligados à **mesma rede local**.
* Certifica-te de que a firewall não está a bloquear a porta **3000**.

---

## 🥋 Bom combate!
