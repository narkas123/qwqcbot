const mineflayer = require('mineflayer')
const express = require('express')

const app = express()
app.use(express.urlencoded({ extended: true }))
app.use(express.json())

// ===== NUSTATYMAI =====
const PORT = process.env.PORT || 3000
const MC_HOST = 'mc.craftmc.lt'
const MC_PORT = 25565
const MC_VERSION = '1.20.1'
const RECONNECT_DELAY = 60_000

// Minecraft paskyros
const STARTER_ACCOUNTS = [
  { username: 'NarkasAFK', password: 'kakas123' },
  { username: 'NarkasAFK1', password: 'kakas123' },
  { username: 'NarkasAFK2', password: 'kakas123' }
]

// Pakeisk šiuos duomenis savo panelės apsaugai!
const PANEL_USER = 'admin'
const PANEL_PASSWORD = '748159263'

// ===== PANELĖS APSAUGA =====
app.use((req, res, next) => {
  const header = req.headers.authorization

  if (header) {
    const [type, credentials] = header.split(' ')

    if (type === 'Basic' && credentials) {
      const decoded = Buffer.from(credentials, 'base64').toString()
      const separator = decoded.indexOf(':')
      const user = decoded.slice(0, separator)
      const pass = decoded.slice(separator + 1)

      if (
        separator !== -1 &&
        user === PANEL_USER &&
        pass === PANEL_PASSWORD
      ) {
        return next()
      }
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="NarkBot panel"')
  return res.status(401).send('Prisijunk prie NarkBot paneles.')
})

// ===== BOTAI =====
const bots = STARTER_ACCOUNTS.map(account => ({
  username: account.username,
  password: account.password,
  bot: null,
  status: 'Paleidžiamas',
  ready: false,
  disabled: false,
  reconnectTimer: null,
  generation: 0
}))

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char])
}

function connectBot(entry) {
  if (entry.disabled || entry.bot) return

  if (entry.reconnectTimer) {
    clearTimeout(entry.reconnectTimer)
    entry.reconnectTimer = null
  }

  const generation = ++entry.generation
  entry.status = 'Jungiasi'
  entry.ready = false

  let bot

  try {
    bot = mineflayer.createBot({
      host: MC_HOST,
      port: MC_PORT,
      username: entry.username,
      auth: 'offline',
      version: MC_VERSION
    })
  } catch (err) {
    entry.status = 'Prisijungimo klaida'
    console.error(`[${entry.username}]`, err.message)
    scheduleReconnect(entry, generation)
    return
  }

  entry.bot = bot

  bot.on('login', () => {
    if (entry.bot !== bot || entry.disabled) return

    console.log(`[${entry.username}] Prisijungė prie serverio.`)
    entry.status = 'Prisijungė, tikrinamas login'

    // Serverio registracijos sistema gali skirtis.
    bot.chat(`/login ${entry.password}`)
  })

  bot.on('spawn', () => {
    if (entry.bot !== bot || entry.disabled) return

    entry.status = 'Prisijungia'
    entry.ready = false

    // Palaukiame, kol serveris užbaigs prisijungimą.
    setTimeout(() => {
      if (
        entry.bot !== bot ||
        entry.disabled ||
        !bot.player
      ) return

      entry.status = 'Prisijungęs'
      entry.ready = true
      console.log(`[${entry.username}] Botas paruoštas.`)

      // Jei /home nereikia, šią eilutę pašalink.
      bot.chat('/home')
    }, 5000)
  })

  bot.on('message', message => {
    console.log(`[${entry.username}] ${message.toString()}`)
  })

  bot.on('kicked', reason => {
    console.log(`[${entry.username}] Išmestas:`, reason)
    if (entry.bot === bot) {
      entry.status = 'Išmestas iš serverio'
      entry.ready = false
    }
  })

  bot.on('error', err => {
    console.error(`[${entry.username}] Klaida:`, err.message)
  })

  bot.on('end', () => {
    // Ignoruojame senos boto kopijos įvykius.
    if (entry.bot !== bot) return

    console.log(`[${entry.username}] Atsijungė.`)
    entry.bot = null
    entry.ready = false
    entry.status = entry.disabled ? 'Išjungtas' : 'Atsijungęs'

    if (!entry.disabled) {
      scheduleReconnect(entry, generation)
    }
  })
}

function scheduleReconnect(entry, generation) {
  if (entry.disabled || entry.reconnectTimer) return

  entry.status = 'Atsijungęs'

  entry.reconnectTimer = setTimeout(() => {
    entry.reconnectTimer = null

    if (entry.disabled || entry.generation !== generation) return

    connectBot(entry)
  }, RECONNECT_DELAY)
}

// ===== PAGRINDINIS PUSLAPIS =====
app.get('/', (req, res) => {
  const botRows = bots.map(entry => {
    const status = entry.disabled
      ? '⚪ Išjungtas'
      : entry.ready
        ? '🟢 Prisijungęs'
        : `🔴 ${escapeHtml(entry.status)}`

    return `
      <li style="margin-bottom:12px">
        <b>${escapeHtml(entry.username)}</b> — ${status}

        <form method="POST" action="/toggle-bot" style="display:inline">
          <input type="hidden" name="username"
                 value="${escapeHtml(entry.username)}">
          <button type="submit">
            ${entry.disabled ? 'Įjungti' : 'Išjungti'}
          </button>
        </form>
      </li>
    `
  }).join('')

  const options = bots.map(entry => `
    <option value="${escapeHtml(entry.username)}">
      ${escapeHtml(entry.username)}
    </option>
  `).join('')

  res.send(`
    <!DOCTYPE html>
    <html lang="lt">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>NarkBot panelė</title>
    </head>
    <body style="font-family:Arial,sans-serif;max-width:700px;margin:30px auto;padding:0 16px">
      <h1>🤖 NarkBot panelė</h1>

      <h2>Botų sąrašas</h2>
      <ul>${botRows}</ul>

      <h2>📤 Komanda arba žinutė</h2>
      <form method="POST" action="/send-command">
        <input name="message" maxlength="200"
               placeholder="Komanda arba žinutė" required>
        <button type="submit">Siųsti visiems</button>
      </form>

      <h2>💸 Pervesti pinigus</h2>
      <form method="POST" action="/transfer-money">
        <p>Botas:</p>
        <select name="bot">${options}</select>

        <p>Gavėjo Minecraft vardas:</p>
        <input name="to" pattern="[A-Za-z0-9_]{1,16}"
               maxlength="16" required>

        <p>Suma:</p>
        <input name="amount" type="number"
               min="1" step="1" required>

        <button type="submit">💸 Siųsti /pay</button>
      </form>

      <p style="color:#666;margin-top:30px">
        Būsenos atnaujinamos atnaujinus puslapį.
      </p>
      <button onclick="location.reload()">Atnaujinti būsenas</button>
    </body>
    </html>
  `)
})

// ===== ĮJUNGTI / IŠJUNGTI =====
app.post('/toggle-bot', (req, res) => {
  const entry = bots.find(b => b.username === req.body.username)

  if (!entry) return res.status(404).send('Botas nerastas.')

  if (entry.disabled) {
    entry.disabled = false
    connectBot(entry)
  } else {
    entry.disabled = true
    entry.ready = false
    entry.status = 'Išjungtas'

    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer)
      entry.reconnectTimer = null
    }

    const bot = entry.bot
    entry.bot = null
    entry.generation++

    if (bot) {
      bot.quit('Išjungtas per panelę')
    }
  }

  res.redirect('/')
})

// ===== KOMANDA VISIEMS BOTAMS =====
app.post('/send-command', (req, res) => {
  const message = String(req.body.message || '').trim()

  if (!message || message.length > 200) {
    return res.status(400).send('Neteisinga arba per ilga komanda.')
  }

  let sent = 0

  for (const entry of bots) {
    if (!entry.disabled && entry.ready && entry.bot) {
      try {
        entry.bot.chat(message)
        sent++
      } catch (err) {
        console.error(`[${entry.username}]`, err.message)
      }
    }
  }

  console.log(`Komanda išsiųsta ${sent} botams.`)
  res.redirect('/')
})

// ===== /PAY =====
app.post('/transfer-money', (req, res) => {
  const username = String(req.body.bot || '')
  const to = String(req.body.to || '').trim()
  const amount = Number(req.body.amount)

  if (!/^[A-Za-z0-9_]{1,16}$/.test(to)) {
    return res.status(400).send('Neteisingas gavėjo vardas.')
  }

  if (!Number.isSafeInteger(amount) || amount < 1) {
    return res.status(400).send('Neteisinga suma.')
  }

  const entry = bots.find(b => b.username === username)

  if (!entry || entry.disabled || !entry.ready || !entry.bot) {
    return res.status(400).send('Pasirinktas botas neprisijungęs.')
  }

  try {
    entry.bot.chat(`/pay ${to} ${amount}`)
    console.log(`[${username}] Siunčiama /pay ${to} ${amount}`)
    res.redirect('/')
  } catch (err) {
    console.error('Nepavyko išsiųsti /pay:', err.message)
    res.status(500).send('Nepavyko išsiųsti komandos.')
  }
})

// ===== PALEIDIMAS =====
app.listen(PORT, () => {
  console.log(`🌐 NarkBot veikia per portą ${PORT}`)

  for (const entry of bots) {
    connectBot(entry)
  }
})
