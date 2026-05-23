const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = 3001;
const CLIENT_ROOT = path.join(__dirname, '..', 'client');

// Allow the frontend to call this API from a separate origin or from file:// during beginner testing.
app.use(cors());
app.use(express.json());
app.use(express.static(CLIENT_ROOT));

// Store OTPs in memory for this beginner project.
// Key: email address, Value: { fullName, otp, expiresAt }
const otpStore = {};

function isValidGmailAddress(email) {
	return typeof email === 'string' && /^[a-zA-Z0-9._%+-]+@gmail\.com$/i.test(email.trim());
}

function generateOtp() {
	// crypto.randomInt gives a secure random number in the requested range.
	return crypto.randomInt(100000, 1000000).toString();
}

function createTransporter() {
	return nodemailer.createTransport({
		service: 'gmail',
		auth: {
			user: process.env.GMAIL_USER,
			pass: process.env.GMAIL_APP_PASSWORD,
		},
	});
}

app.post('/send-otp', async (req, res) => {
	try {
		const { fullName, email } = req.body;
		const cleanedName = typeof fullName === 'string' ? fullName.trim() : '';
		const cleanedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

		if (!cleanedName) {
			return res.status(400).json({ success: false, message: 'Full name is required.' });
		}

		if (!isValidGmailAddress(cleanedEmail)) {
			return res.status(400).json({ success: false, message: 'Please enter a valid Gmail address.' });
		}

		if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
			return res.status(500).json({
				success: false,
				message: 'Email service is not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD first.',
			});
		}

		const otp = generateOtp();
		const expiresAt = Date.now() + 5 * 60 * 1000;

		otpStore[cleanedEmail] = {
			fullName: cleanedName,
			otp,
			expiresAt,
		};

		const transporter = createTransporter();

		await transporter.sendMail({
			from: process.env.GMAIL_USER,
			to: cleanedEmail,
			subject: 'Your OTP Code',
			text: `Hello ${cleanedName},\n\nYour OTP is: ${otp}\n\nThis code expires in 5 minutes.`,
			html: `
				<div style="font-family: Arial, sans-serif; line-height: 1.6;">
					<h2>Hello ${cleanedName}</h2>
					<p>Your OTP code is:</p>
					<div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; margin: 16px 0;">
						${otp}
					</div>
					<p>This code expires in 5 minutes.</p>
				</div>
			`,
		});

		return res.json({
			success: true,
			message: 'OTP sent successfully. Check your Gmail inbox.',
		});
	} catch (error) {
		console.error('Send OTP error:', error);
		return res.status(500).json({
			success: false,
			message: 'Failed to send OTP. Check your Gmail App Password and server logs.',
		});
	}
});

app.post('/verify-otp', (req, res) => {
	try {
		const { email, otp } = req.body;
		const cleanedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
		const cleanedOtp = typeof otp === 'string' ? otp.trim() : '';

		if (!cleanedEmail || !cleanedOtp) {
			return res.status(400).json({ success: false, message: 'Email and OTP are required.' });
		}

		const storedRecord = otpStore[cleanedEmail];

		if (!storedRecord) {
			return res.status(400).json({ success: false, message: 'OTP not found or already used.' });
		}

		if (Date.now() > storedRecord.expiresAt) {
			delete otpStore[cleanedEmail];
			return res.status(400).json({ success: false, message: 'OTP expired. Please request a new one.' });
		}

		if (storedRecord.otp !== cleanedOtp) {
			return res.status(400).json({ success: false, message: 'Invalid OTP. Please try again.' });
		}

		delete otpStore[cleanedEmail];

		return res.json({
			success: true,
			message: `Email verified successfully for ${storedRecord.fullName}.`,
		});
	} catch (error) {
		console.error('Verify OTP error:', error);
		return res.status(500).json({
			success: false,
			message: 'Failed to verify OTP.',
		});
	}
});

app.get('/', (req, res) => {
	res.sendFile(path.join(CLIENT_ROOT, 'index.html'));
});

app.listen(PORT, () => {
	console.log(`Server running on http://localhost:${PORT}`);
	console.log('Make sure GMAIL_USER and GMAIL_APP_PASSWORD are set in your terminal session.');
});
