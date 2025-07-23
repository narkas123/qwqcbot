// Reikalingi moduliai
const mineflayer = require('mineflayer')
const express = require('express')
const axios = require('axios')
const fs = require('fs')
const sqlite3 = require('sqlite3').verbose()
const app = express()

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// SQLite duomenų bazė
const db = new sqlite3.Database('./bots.db')
db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS bots (username TEXT PRIMARY KEY, password TEXT, disabled INTEGER DEFAULT 0)")
})

let bots = []

function loadBotsFromDB() {
  db.all("SELECT * FROM bots WHERE disabled = 0", [], (err, rows) => {
    if (err) return console.error("❌ Klaida skaitant duomenų bazę:", err.message)
    rows.forEach(({ username, password }) => {
      const bot = createBot(username, password)
      bots.push(bot)
    })
  })
}

function createBot(username, password) {
  const bot = mineflayer.createBot({
    host: 'mc.craftmc.lt',
    port: 25565,
    username: username,
    auth: 'offline',
    version: '1.19.4',
  })

  bot.on('login', () => {
    console.log(`✅ ${username} prisijungė!`)
    bot.chat(`/login ${password}`)
    setTimeout(() => {
      bot.chat('/home')
      bot.ready = true
    }, 5000)
    bot.status = 'Prisijungęs'
  })

  bot.on('message', (msg) => {
    console.log(`[${username}] ${msg.toString()}`)
  })

  bot.on('end', () => {
    console.log(`⚠️ ${username} atsijungė, bandome iš naujo po 60s...`)
    bot.status = 'Atsijungęs'
    setTimeout(() => {
      db.get("SELECT disabled FROM bots WHERE username = ?", [username], (err, row) => {
        if (!row || row.disabled) return
        const newBot = createBot(username, password)
        const index = bots.findIndex(b => b.username === username)
        if (index !== -1) bots[index] = newBot
      })
    }, 60000)
  })

  bot.on('error', (err) => {
    console.log(`❌ Klaida botui ${username}:`, err.message)
  })

  bot.on('kicked', (reason) => {
    console.log(`⛔ ${username} buvo išmestas:`, reason)
  })

  bot.username = username
  bot.password = password
  bot.status = 'Prisijungęs'
  bot.ready = false
  return bot
}

app.get('/', (req, res) => {
  db.all("SELECT * FROM bots", [], (err, rows) => {
    const botList = rows.map(b => `<li>${b.username} ${b.disabled ? '⚪ Išjungtas' : bots.find(bt => bt.username === b.username && bt.status === 'Prisijungęs') ? '🟢' : '🔴'}
      <form style='display:inline' method='POST' action='/toggle-bot'>
        <input type='hidden' name='username' value='${b.username}'>
        <button>${b.disabled ? 'Įjungti' : 'Išjungti'}</button>
      </form></li>`).join('')

    res.send(`
      <h2>➕ Pridėti savo botą</h2>
      <form method="POST" action="/add-bot" style="display:flex;flex-direction:column;width:300px">
        <input name="username" placeholder="Minecraft vardas" required>
        <input name="password" placeholder="Slaptažodis" required>
        <button type="submit">Pridėti botą</button>
      </form>

      <h3>🟢 Botų sąrašas:</h3>
      <ul>${botList}</ul>

      <h2>📤 Išsiųsti komandą arba žinutę</h2>
      <form method="POST" action="/send-command" style="display:flex;flex-direction:column;width:300px">
        <input name="message" placeholder="Komanda arba žinutė" required>
        <button type="submit">Siųsti visiems botams</button>
      </form>

      <h2>💸 Persivesti pinigus</h2>
      <form method="POST" action="/transfer-money" style="display:flex;flex-direction:column;width:300px">
        <label>Pasirinkti botą:
          <select name="bot">
            ${bots.map(b => `<option value="${b.username}">${b.username}</option>`).join('')}
          </select>
        </label>
        <input name="to" placeholder="Kam siųsti (pvz. tavo nickas)" required>
        <input name="amount" type="number" placeholder="Suma" required>
        <button type="submit">💸 Siųsti</button>
      </form>
    `)
  })
})

app.post('/add-bot', (req, res) => {
  const { username, password } = req.body
  if (!username || !password) return res.status(400).send("❌ Trūksta username arba password")

  db.run("INSERT OR REPLACE INTO bots (username, password, disabled) VALUES (?, ?, 0)", [username, password], (err) => {
    if (err) return res.status(500).send("❌ Nepavyko įrašyti į DB")
    const bot = createBot(username, password)
    bots.push(bot)
    res.redirect('/')
  })
})

app.post('/toggle-bot', (req, res) => {
  const { username } = req.body
  db.get("SELECT disabled FROM bots WHERE username = ?", [username], (err, row) => {
    if (row) {
      const newStatus = row.disabled ? 0 : 1
      db.run("UPDATE bots SET disabled = ? WHERE username = ?", [newStatus, username])
      if (newStatus === 1) {
        bots = bots.filter(b => b.username !== username)
      } else {
        db.get("SELECT * FROM bots WHERE username = ?", [username], (err, data) => {
          if (data) bots.push(createBot(data.username, data.password))
        })
      }
    }
    res.redirect('/')
  })
})

app.post('/send-command', (req, res) => {
  const { message } = req.body
  if (!message) return res.status(400).send("❌ Žinutė negali būti tuščia")

  bots.forEach(bot => {
    try {
      if (bot.ready && bot.player && bot.player.uuid) bot.chat(message)
    } catch (e) {
      console.log(`⚠️ Nepavyko botui ${bot.username}:`, e.message)
    }
  })

  res.redirect('/')
})

app.post('/transfer-money', (req, res) => {
  const { bot: botName, to, amount } = req.body
  const bot = bots.find(b => b.username === botName)
  if (!bot || !to || !amount) return res.status(400).send("❌ Trūksta duomenų arba blogas botas")

  try {
    if (bot.ready && bot.player && bot.player.uuid) {
      bot.chat(`/pay ${to} ${amount}`)
      res.redirect('/')
    } else throw new Error('Botas neprisijungęs arba neparuoštas')
  } catch (e) {
    console.error(`⚠️ Nepavyko išsiųsti /pay komandą: ${e.message}`)
    res.status(500).send("❌ Nepavyko išsiųsti komandos")
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`🌐 Serveris veikia ant ${PORT}`)
  loadBotsFromDB()
})

setInterval(() => {
  axios.get('https://narkbot.onrender.com/').then(() => console.log('📡 Ping OK')).catch(() => console.log('⚠️ Ping NEPAVYKO'))
}, 5 * 60 * 1000)
