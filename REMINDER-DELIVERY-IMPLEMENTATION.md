# Reminder Delivery Implementation Guide

## Current Status

Phase 11 implements the **infrastructure** for reminders:
- ✅ Creating reminders
- ✅ Storing reminders in database
- ✅ Background job to find due reminders
- ✅ Marking reminders as delivered
- ⚠️ **Actual delivery mechanism is a placeholder**

## What "Delivery" Currently Does

When you run `npm run reminder-job`:
1. Finds reminders where `reminder_date <= today` and `status = 'pending'`
2. For each reminder:
   - Marks it as `delivered` in the database
   - Increments `delivery_attempts`
   - Records `last_delivered_at` timestamp
3. Returns count of delivered reminders

**It does NOT actually notify the farmer yet.**

---

## Implementation Options

### Option 1: SMS Delivery (Recommended for Farmers) 📱

**Best for**: Farmers who may not have smartphones or internet access

#### Setup Twilio

```bash
# Install Twilio SDK
npm install twilio
```

```bash
# Add to .env file
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890
```

#### Implementation

Create `src/infrastructure/sms/twilio-client.ts`:

```typescript
import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;

if (!accountSid || !authToken || !fromNumber) {
  throw new Error('Twilio credentials not configured');
}

const client = twilio(accountSid, authToken);

export async function sendSMS(
  toPhoneNumber: string,
  message: string
): Promise<void> {
  await client.messages.create({
    body: message,
    to: toPhoneNumber,
    from: fromNumber,
  });
}

export function formatReminderMessage(reminder: {
  activity: string;
  fieldName?: string | null;
  crop?: string | null;
}): string {
  const parts = ['Reminder:', reminder.activity];
  
  if (reminder.fieldName) {
    parts.push(reminder.fieldName);
  }
  
  if (reminder.crop) {
    parts.push(`(${reminder.crop})`);
  }
  
  return parts.join(' ');
}
```

#### Update the job

In `src/jobs/deliver-reminders.ts`:

```typescript
import { sendSMS, formatReminderMessage } from '../infrastructure/sms/twilio-client';
import { getFarmerPhoneNumber } from '../infrastructure/db/farm-event-repository';

// Inside the delivery loop:
for (const reminder of dueReminders) {
  try {
    // Get farmer's phone number
    const phoneNumber = await getFarmerPhoneNumber(db, reminder.farmId);
    
    if (phoneNumber) {
      // Send SMS
      const message = formatReminderMessage(reminder);
      await sendSMS(phoneNumber, message);
    }
    
    await markDelivered(db, reminder.id);
    result.delivered++;
  } catch (error) {
    // ... error handling
  }
}
```

---

### Option 2: In-App Notifications 📲

**Best for**: When farmers use the web app regularly

#### Add notification banner to UI

Update `app/page.tsx`:

```typescript
// Fetch pending reminders on page load
const [reminders, setReminders] = useState([]);

useEffect(() => {
  fetch('/api/reminders')
    .then(res => res.json())
    .then(data => setReminders(data.reminders));
}, []);

// Show notification banner
{reminders.length > 0 && (
  <div className="reminder-banner">
    🔔 You have {reminders.length} reminder(s)
    <button onClick={() => showReminders()}>View</button>
  </div>
)}
```

#### Create reminders panel

```typescript
function RemindersPanel({ reminders }) {
  return (
    <div className="reminders-panel">
      <h2>Your Reminders</h2>
      {reminders.map(reminder => (
        <div key={reminder.id} className="reminder-card">
          <span className="activity">{reminder.activity}</span>
          {reminder.fieldName && <span>{reminder.fieldName}</span>}
          <span className="date">{formatDate(reminder.reminderDate)}</span>
        </div>
      ))}
    </div>
  );
}
```

---

### Option 3: Push Notifications (Mobile App) 📱

**Best for**: Native mobile app

#### Using Firebase Cloud Messaging

```bash
npm install firebase-admin
```

```typescript
import admin from 'firebase-admin';

// Initialize Firebase
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

export async function sendPushNotification(
  deviceToken: string,
  reminder: Reminder
): Promise<void> {
  await admin.messaging().send({
    token: deviceToken,
    notification: {
      title: 'Farm Reminder',
      body: `${reminder.activity}${reminder.fieldName ? ' - ' + reminder.fieldName : ''}`,
    },
    data: {
      reminderId: reminder.id,
      type: 'reminder',
    },
  });
}
```

---

### Option 4: Email Notifications 📧

**Best for**: Farmers with email access

#### Using Nodemailer

```bash
npm install nodemailer
```

```typescript
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransporter({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

export async function sendEmailReminder(
  toEmail: string,
  reminder: Reminder
): Promise<void> {
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: toEmail,
    subject: 'Farm Reminder',
    text: formatReminderMessage(reminder),
    html: `
      <h2>Farm Reminder</h2>
      <p><strong>${reminder.activity}</strong></p>
      ${reminder.fieldName ? `<p>Field: ${reminder.fieldName}</p>` : ''}
      ${reminder.crop ? `<p>Crop: ${reminder.crop}</p>` : ''}
    `,
  });
}
```

---

## 🎯 Recommended Implementation Order

1. **Start with In-App Notifications** (easiest)
   - Show reminders banner when farmer opens app
   - No external dependencies
   - Good for MVP

2. **Add SMS Delivery** (most accessible)
   - Reaches farmers without smartphones
   - Works in areas with limited internet
   - Uses Twilio or similar service

3. **Consider Push Notifications** (if building mobile app)
   - Better user experience on mobile
   - Instant delivery
   - Requires native mobile app

---

## 🔄 Current vs. Future Flow

### Current Flow (Phase 11):
```
1. Farmer: "Remind me to weed tomorrow"
2. System: Creates reminder in database
3. Job runs: Finds due reminders
4. Job: Marks as "delivered" ✓
5. (No actual notification sent)
```

### Future Flow (With Delivery):
```
1. Farmer: "Remind me to weed tomorrow"
2. System: Creates reminder in database
3. Job runs: Finds due reminders
4. Job: Sends SMS/notification to farmer 📱
5. Job: Marks as "delivered" ✓
6. Farmer: Receives notification
```

---

## 💡 Testing Delivery

### Test SMS (when implemented):
```bash
# Create a reminder for today
node scripts/create-test-reminder.js

# Run the job
npm run reminder-job

# Check your phone for SMS
```

### Test In-App (when implemented):
```bash
# Start the app
npm run dev

# Open http://localhost:3000
# You should see a notification banner
```

---

## 📊 Database Status Meanings

- **pending**: Reminder created, not yet delivered
- **delivered**: Job attempted delivery (successfully or not)
- **cancelled**: Farmer cancelled the reminder

Note: Currently "delivered" just means "the job processed it", not that the farmer actually received it.

---

## 🚀 Quick Implementation: In-App Notifications

Want to implement in-app notifications now? Just:

1. Add API endpoint to get due reminders
2. Show banner in UI when reminders exist
3. Update job to mark as delivered when shown

This is the quickest way to have functional reminder delivery!

Would you like me to implement any of these options?
