# MCS Student Cleaning (PWA + Node)

A lightweight bookings app for student accommodation with QR-based location prefill and SMS confirmations.

## Quick start
```bash
npm install
cp .env.example .env
# Fill TWILIO_* and TWILIO_FROM in .env (E.164 phone, e.g. +447...)
npm start
# Visit http://localhost:3000 and Add to Home Screen
```

## Environment
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` required for SMS.
- `PORT` optional (defaults to 3000).

## Customise
- Services/hours/capacity: edit `server.js` (SERVICES, CAPACITY_PER_SLOT, generateSlots hours).
- Branding: `public/index.html`, icons in `public/icons/`, `public/mcs-logo.png`.
- Data store: JSON at `data/bookings.json`. Replace with Postgres later if needed.

## Admin tools
- On the homepage: use **Admin tools** to view bookings by date and generate QR codes per building/flat/room.
- Print those QR codes and place them on doors/kitchens.

## Notes
- PWA caches static assets for offline. API calls require connectivity.
- Phone numbers must be in E.164 format for SMS, e.g. `+447...`.
