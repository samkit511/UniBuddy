/**
 * Seed demo student accounts (pre-verified, no email needed)
 * Run: node backend/seedDemoUsers.js
 */
import mongoose from 'mongoose';
import bcryptjs from 'bcryptjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/unibuddy';

// ── Schemas (inline to avoid import issues) ──────────────────────────────────
const userSchema = new mongoose.Schema({
  email: String,
  password: String,
  fatherName: String,
  motherName: String,
  contactNumber: String,
  photo: { type: String, default: '' },
  collegeIdCard: { type: String, default: '' },
  role: { type: String, default: 'STUDENT' },
  isVerified: { type: Boolean, default: false },
  lastLogin: Date,
  createdAt: { type: Date, default: Date.now },
});

const studentSchema = new mongoose.Schema({
  name: String,
  email: String,
  rollNo: String,
  department: String,
  year: String,
  fatherName: String,
  motherName: String,
  contactNumber: String,
  status: { type: String, default: 'ACTIVE' },
});

const User = mongoose.model('User', userSchema);
const Student = mongoose.model('Student', studentSchema);

// ── Demo accounts ─────────────────────────────────────────────────────────────
const DEMO_STUDENTS = [
  {
    email: 'student1@gdgu.org',
    password: 'Demo@1234',
    name: 'Rahul Sharma',
    rollNo: 'DEMO-001',
    department: 'BCA',
    year: '2',
    fatherName: 'Rajesh Sharma',
    motherName: 'Sunita Sharma',
    contactNumber: '9876543210',
  },
  {
    email: 'student2@gdgu.org',
    password: 'Demo@1234',
    name: 'Priya Singh',
    rollNo: 'DEMO-002',
    department: 'B.Tech CSE',
    year: '3',
    fatherName: 'Amit Singh',
    motherName: 'Kavita Singh',
    contactNumber: '9876543211',
  },
  {
    email: 'student3@gdgu.org',
    password: 'Demo@1234',
    name: 'Arjun Verma',
    rollNo: 'DEMO-003',
    department: 'MCA',
    year: '1',
    fatherName: 'Suresh Verma',
    motherName: 'Meena Verma',
    contactNumber: '9876543212',
  },
];

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  for (const demo of DEMO_STUDENTS) {
    const existing = await User.findOne({ email: demo.email });
    if (existing) {
      console.log(`⚠️  ${demo.email} already exists — skipping`);
      continue;
    }

    const hashed = await bcryptjs.hash(demo.password, 10);

    await User.create({
      email: demo.email,
      password: hashed,
      fatherName: demo.fatherName,
      motherName: demo.motherName,
      contactNumber: demo.contactNumber,
      role: 'STUDENT',
      isVerified: true,   // pre-verified — no email OTP needed
      lastLogin: new Date(),
    });

    await Student.create({
      name: demo.name,
      email: demo.email,
      rollNo: demo.rollNo,
      department: demo.department,
      year: demo.year,
      fatherName: demo.fatherName,
      motherName: demo.motherName,
      contactNumber: demo.contactNumber,
      status: 'ACTIVE',
    });

    console.log(`✅ Created: ${demo.email} / ${demo.password}`);
  }

  await mongoose.disconnect();
  console.log('\nDone! Demo accounts ready.');
  console.log('\n--- LOGIN CREDENTIALS ---');
  DEMO_STUDENTS.forEach(d => {
    console.log(`Email: ${d.email}  |  Password: ${d.password}`);
  });
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
