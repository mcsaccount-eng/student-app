
const fs = require('fs');
const path = require('path');
const express = require('express');
require('dotenv').config();

const app = express();



// --- Twilio SMS ---
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  try {
    const twilio = require('twilio');
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    console.log('Twilio SMS enabled.');
  } catch (e) {
    console.warn('Twilio not available:', e.message);
  }
} else {
  console.log('Twilio SMS disabled (missing env vars).');
}

// --- Simple in-file storage ---
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'bookings.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ bookings: [] }, null, 2));

function loadDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// --- Helpers ---
function toISOLocal(date) {
  // date is a Date in local system time
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) + ":00.000Z";
}
function parseISO(s) {
  // Always parse as UTC, then convert to Date
  return new Date(s);
}
function pad(n){ return n<10 ? '0'+n : ''+n; }

function generateSlots({ date, openHour=9, closeHour=18, slotMinutes=60 }) {
  // date format: 'YYYY-MM-DD'
  const [y,m,d] = date.split('-').map(Number);
  const slots = [];
  for (let h=openHour; h+ (slotMinutes/60) <= closeHour; h++) {
    const startLocal = new Date(y, m-1, d, h, 0, 0, 0);
    const endLocal = new Date(startLocal.getTime() + slotMinutes*60000);
    slots.push({
      start: startLocal.toISOString(),
      end: endLocal.toISOString()
    });
  }
  return slots;
}

function overlap(aStart, aEnd, bStart, bEnd) {
  return (aStart < bEnd) && (bStart < aEnd);
}

// --- Config ---
const SERVICES = [
  { id: 'room_clean', name: 'Room cleaning', durationMinutes: 60 },
  { id: 'kitchen_clean', name: 'Kitchen cleaning', durationMinutes: 60 }
];
// Capacity: how many bookings can be handled per slot (e.g., number of cleaners)
const CAPACITY_PER_SLOT = 2;

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Routes ---
app.get('/api/services', (req,res)=>{
  res.json({ services: SERVICES });
});

app.get('/api/availability', (req,res)=>{
  try {
    const { date, serviceId } = req.query;
    if (!date) return res.status(400).json({ error: "Missing 'date' (YYYY-MM-DD)" });
    const svc = SERVICES.find(s => s.id === serviceId) || SERVICES[0];
    const slotMinutes = svc.durationMinutes;

    const db = loadDB();
    const allSlots = generateSlots({ date, slotMinutes });

    // For each slot, count bookings that collide
    const available = allSlots.filter(slot => {
      const sStart = parseISO(slot.start);
      const sEnd = parseISO(slot.end);
      const overlappingCount = db.bookings.filter(b => {
        // match by service (optional) – here we allow mixed services in same slot up to capacity
        const bStart = parseISO(b.start);
        const bEnd = parseISO(b.end);
        return overlap(sStart, sEnd, bStart, bEnd) && b.status !== 'cancelled';
      }).length;
      return overlappingCount < CAPACITY_PER_SLOT;
    });

    res.json({ date, serviceId: svc.id, slots: available });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/bookings', (req,res)=>{
  try {
    const { serviceId, name, email, phone, notes, building, flat, room, start } = req.body || {};
    if (!serviceId) return res.status(400).json({ error: "Missing serviceId" });
    if (!name) return res.status(400).json({ error: "Missing name" });
    if (!start) return res.status(400).json({ error: "Missing start (ISO datetime)" });
    const svc = SERVICES.find(s => s.id === serviceId);
    if (!svc) return res.status(400).json({ error: "Invalid serviceId" });

    const startDate = parseISO(start);
    if (isNaN(startDate.getTime())) return res.status(400).json({ error: "Invalid start time" });
    const endDate = new Date(startDate.getTime() + svc.durationMinutes*60000);

    const db = loadDB();

    // Capacity check
    const overlapping = db.bookings.filter(b => {
      const bStart = parseISO(b.start);
      const bEnd = parseISO(b.end);
      return overlap(startDate, endDate, bStart, bEnd) && b.status !== 'cancelled';
    });
    if (overlapping.length >= CAPACITY_PER_SLOT) {
      return res.status(409).json({ error: "Slot no longer available" });
    }

    const id = 'bk_' + Math.random().toString(36).slice(2,10);
    const booking = {
      id,
      serviceId,
      serviceName: svc.name,
      name, email: email || '', phone: phone || '',
      notes: notes || '',
      building: building || '',
      flat: flat || '',
      room: room || '',
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      status: 'confirmed',
      createdAt: new Date().toISOString()
    };
    db.bookings.push(booking);
    saveDB(db);

    // Fire-and-forget SMS confirmation
    if (twilioClient && phone && /^\+?[1-9]\d{6,14}$/.test(phone)) {
      const msg = `MCS Cleaning: ${svc.name} booked for ${new Date(startDate).toLocaleString()} in ${building}${flat?(' Flat '+flat):''}${room?(' Room '+room):''}. Ref ${id}.`;
      twilioClient.messages.create({
        body: msg,
        to: phone,
        from: process.env.TWILIO_FROM
      }).then(()=>console.log('SMS sent to', phone)).catch(err=>console.warn('SMS failed:', err.message));
    }

    res.json({ ok: true, booking });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/bookings', (req,res)=>{
  // Optional filters: date=YYYY-MM-DD
  try {
    const { date } = req.query;
    const db = loadDB();
    let bookings = db.bookings.sort((a,b)=>a.start.localeCompare(b.start));
    if (date) {
      bookings = bookings.filter(b => b.start.startsWith(date));
    }
    res.json({ bookings });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/health', (req,res)=>res.json({ ok:true }));

// Fallback to index for SPA-style routes (not strictly needed here)
app.get('*', (req,res)=>{
  const filePath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(filePath)) return res.sendFile(filePath);
  return res.status(404).send('Not found');
});

const PORT = process.env.PORT || 3000; 

app.listen(PORT, ()=>{
  console.log(`Student cleaning app running on http://localhost:${PORT}`);
});
