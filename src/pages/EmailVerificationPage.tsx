import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuthStore } from "../store/authStore";
import toast from "react-hot-toast";
import { X } from "lucide-react";

const EmailVerificationPage = () => {
	const [code, setCode] = useState(["", "", "", "", "", ""]);
	const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
	const navigate = useNavigate();

	const { error, isLoading, verifyEmail, user, logout } = useAuthStore();

	const handleChange = (index: number, value: string) => {
		const newCode = [...code];

		// Handle pasted content
		if (value.length > 1) {
			const pastedCode = value.slice(0, 6).split("");
			for (let i = 0; i < 6; i++) {
				newCode[i] = pastedCode[i] || "";
			}
			setCode(newCode);

			// Focus on the last non-empty input or the first empty one
			const lastFilledIndex = newCode.findLastIndex((digit) => digit !== "");
			const focusIndex = lastFilledIndex < 5 ? lastFilledIndex + 1 : 5;
			inputRefs.current[focusIndex]?.focus();
		} else {
			newCode[index] = value;
			setCode(newCode);

			// Move focus to the next input field if value is entered
			if (value && index < 5) {
				inputRefs.current[index + 1]?.focus();
			}
		}
	};

	const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Backspace" && !code[index] && index > 0) {
			inputRefs.current[index - 1]?.focus();
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		const verificationCode = code.join("");
		try {
			await verifyEmail(verificationCode);
			toast.success("Email verified successfully");
			
			// Redirect based on role
			const currentUser = useAuthStore.getState().user;
			if (currentUser?.role === 'ADMIN') {
				navigate('/admin');
			} else {
				navigate('/');
			}
		} catch (error) {
			console.log(error);
		}
	};

	// Auto submit when all fields are filled
	useEffect(() => {
		if (code.every((digit) => digit !== "")) {
			handleSubmit(new Event("submit") as any);
		}
	}, [code]);

	const handleClose = async () => {
		// Logout user and redirect to home
		try {
			await logout();
			navigate('/');
			toast.success('Verification cancelled');
		} catch (error) {
			console.error('Logout error:', error);
			navigate('/');
		}
	};

	return (
		<div className="min-h-screen bg-[#080c14] text-slate-100 flex items-center justify-center">
			{/* Background Accents */}
			<div className="fixed inset-0 pointer-events-none z-0">
				<div className="absolute -top-32 -right-32 w-[700px] h-[700px] bg-indigo-950/30 blur-[160px] rounded-full"></div>
				<div className="absolute -bottom-40 -left-40 w-[700px] h-[700px] bg-yellow-900/10 blur-[160px] rounded-full"></div>
			</div>

			<div className='max-w-md w-full bg-slate-900/95 backdrop-filter backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-800 overflow-hidden relative z-10 mx-4'>
				{/* Close Button */}
				<button
					onClick={handleClose}
					className="absolute top-4 right-4 z-10 bg-slate-800/90 hover:bg-slate-700 text-slate-400 hover:text-white rounded-full p-2 transition-all duration-200 hover:scale-110"
					aria-label="Close"
				>
					<X className="w-5 h-5" />
				</button>

				<motion.div
					initial={{ opacity: 0, y: -50 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.5 }}
					className='p-8 w-full'
				>
					<h2 className='text-3xl font-bold mb-2 text-center bg-gradient-to-r from-blue-400 via-purple-400 to-indigo-400 text-transparent bg-clip-text'>
						Verify Your Email
					</h2>
					<p className='text-center text-slate-400 text-sm mb-8'>Enter the 6-digit code sent to your email address.</p>

					<form onSubmit={handleSubmit} className='space-y-6'>
						<div className='flex justify-between'>
							{code.map((digit, index) => (
								<input
									key={index}
									ref={(el) => { inputRefs.current[index] = el; }}
									type='text'
									maxLength={6}
									value={digit}
									onChange={(e) => handleChange(index, e.target.value)}
									onKeyDown={(e) => handleKeyDown(index, e)}
									className='w-12 h-12 text-center text-2xl font-bold bg-slate-800 text-white border-2 border-slate-700 rounded-lg focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all'
								/>
							))}
						</div>
						{error && <p className='text-red-400 text-sm font-medium bg-red-500/10 border border-red-500/20 rounded-lg p-3'>{error}</p>}
						<motion.button
							whileHover={{ scale: 1.05 }}
							whileTap={{ scale: 0.95 }}
							type='submit'
							disabled={isLoading || code.some((digit) => !digit)}
							className='w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold py-3 px-4 rounded-lg shadow-lg hover:from-blue-700 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 transition-all'
						>
							{isLoading ? "Verifying..." : "Verify Email"}
						</motion.button>
					</form>
				</motion.div>
			</div>
		</div>
	);
};
export default EmailVerificationPage;
