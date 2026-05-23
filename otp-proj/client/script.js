const API_BASE_URL = 'http://localhost:3001';

const fullNameInput = document.getElementById('fullName');
const emailInput = document.getElementById('email');
const otpInput = document.getElementById('otp');
const sendOtpBtn = document.getElementById('sendOtpBtn');
const verifyOtpBtn = document.getElementById('verifyOtpBtn');
const otpSection = document.getElementById('otpSection');
const messageBox = document.getElementById('message');
const themeButtons = document.querySelectorAll('[data-theme]');
const menuToggle = document.querySelector('[data-menu-toggle]');
const mobileNav = document.querySelector('[data-mobile-nav]');

function showMessage(text, type) {
	messageBox.textContent = text;
	messageBox.className = `message ${type}`;
}

function setLoading(button, isLoading, defaultText) {
	button.disabled = isLoading;
	button.textContent = isLoading ? 'Please wait...' : defaultText;
}

function setTheme(theme) {
	document.body.className = theme;
	localStorage.setItem('theme', theme);
	themeButtons.forEach((button) => {
		button.classList.toggle('is-active', button.dataset.theme === theme);
	});
}

	function scrollToSection(sectionId) {
		if (sectionId === 'home') {
			window.scrollTo({ top: 0, behavior: 'smooth' });
			return;
		}

	const targetElement = document.getElementById(sectionId);
	if (targetElement) {
		targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
}

const storedTheme = localStorage.getItem('theme') || 'light';
setTheme(storedTheme);

themeButtons.forEach((button) => {
	button.addEventListener('click', () => setTheme(button.dataset.theme));
});

if (menuToggle && mobileNav) {
	menuToggle.addEventListener('click', () => {
		const isOpen = mobileNav.classList.toggle('is-open');
		menuToggle.setAttribute('aria-expanded', String(isOpen));
	});
}

sendOtpBtn.addEventListener('click', async () => {
	const fullName = fullNameInput.value.trim();
	const email = emailInput.value.trim();

	if (!fullName || !email) {
		showMessage('Please enter both full name and Gmail address.', 'error');
		return;
	}

	try {
		setLoading(sendOtpBtn, true, 'Send OTP');

		const response = await fetch(`${API_BASE_URL}/send-otp`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ fullName, email }),
		});

		const data = await response.json();

		if (!response.ok) {
			showMessage(data.message || 'Failed to send OTP.', 'error');
			return;
		}

		otpSection.classList.remove('hidden');
		showMessage(data.message, 'success');
	} catch (error) {
		showMessage('Network error. Make sure the backend server is running.', 'error');
	} finally {
		setLoading(sendOtpBtn, false, 'Send OTP');
	}
});

verifyOtpBtn.addEventListener('click', async () => {
	const email = emailInput.value.trim();
	const otp = otpInput.value.trim();

	if (!email || !otp) {
		showMessage('Enter both your email and the OTP.', 'error');
		return;
	}

	try {
		setLoading(verifyOtpBtn, true, 'Verify OTP');

		const response = await fetch(`${API_BASE_URL}/verify-otp`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ email, otp }),
		});

		const data = await response.json();

		if (!response.ok) {
			showMessage(data.message || 'OTP verification failed.', 'error');
			return;
		}

		showMessage(data.message, 'success');
		otpInput.value = '';
		otpSection.classList.add('hidden');

		const signinForm = document.createElement('form');
		signinForm.method = 'POST';
		signinForm.action = 'http://localhost:3000/signin';
		signinForm.style.display = 'none';

		const nameField = document.createElement('input');
		nameField.type = 'hidden';
		nameField.name = 'name';
		nameField.value = fullNameInput.value.trim();

		const emailField = document.createElement('input');
		emailField.type = 'hidden';
		emailField.name = 'email';
		emailField.value = email;

		signinForm.append(nameField, emailField);
		document.body.appendChild(signinForm);
		signinForm.submit();
	} catch (error) {
		showMessage('Network error. Make sure the backend server is running.', 'error');
	} finally {
		setLoading(verifyOtpBtn, false, 'Verify OTP');
	}
});
