import type { SupportedLanguage } from '../types/forensics.ts';

export type VoiceCommandAction =
  | { type: 'navigate'; tab: 'lab' | 'livecam' | 'graph' | 'agent' | 'alerts' | 'community' | 'ledger'; label: string }
  | { type: 'new_case'; label: string }
  | { type: 'run_analysis'; label: string }
  | { type: 'read_findings'; label: string }
  | { type: 'explain_risk'; label: string }
  | { type: 'latest_report'; label: string }
  | { type: 'stop_speech'; label: string }
  | { type: 'change_language'; lang: SupportedLanguage; label: string }
  | { type: 'confirm_delete_case'; label: string }
  | { type: 'confirm_delete_evidence'; label: string }
  | { type: 'unknown'; transcript: string; label: string };

export function parseVoiceCommand(rawTranscript: string): VoiceCommandAction {
  const txt = rawTranscript.trim().toLowerCase();
  if (!txt) {
    return { type: 'unknown', transcript: rawTranscript, label: 'Empty command' };
  }

  // Sensitive destructive intents NEVER execute silently — always ask confirmation first
  if (/(delete case|remove case|ಪ್ರಕರಣ ಅಳಿಸಿ|केस हटाओ|வழக்கை நீக்கு|కేసు తొలగించు|കേസ് നീക്കം)/i.test(txt)) {
    return { type: 'confirm_delete_case', label: 'Confirm Delete Active Case' };
  }
  if (/(delete evidence|remove evidence|remove file|ಸಾಕ್ಷ್ಯ ಅಳಿಸಿ|साक्ष्य हटाओ|ஆதாரம் நீக்கு)/i.test(txt)) {
    return { type: 'confirm_delete_evidence', label: 'Confirm Remove Evidence' };
  }

  // Language switches
  if (/(switch to kannada|kannada|ಕನ್ನಡ)/i.test(txt)) {
    return { type: 'change_language', lang: 'kn', label: 'Switch language to Kannada' };
  }
  if (/(switch to hindi|hindi|हिन्दी|हिंदी)/i.test(txt)) {
    return { type: 'change_language', lang: 'hi', label: 'Switch language to Hindi' };
  }
  if (/(switch to tamil|tamil|தமிழ்)/i.test(txt)) {
    return { type: 'change_language', lang: 'ta', label: 'Switch language to Tamil' };
  }
  if (/(switch to telugu|telugu|తెలుగు)/i.test(txt)) {
    return { type: 'change_language', lang: 'te', label: 'Switch language to Telugu' };
  }
  if (/(switch to malayalam|malayalam|മലയാളം)/i.test(txt)) {
    return { type: 'change_language', lang: 'ml', label: 'Switch language to Malayalam' };
  }
  if (/(switch to english|english)/i.test(txt)) {
    return { type: 'change_language', lang: 'en', label: 'Switch language to English' };
  }

  // Stop speech
  if (/(stop speaking|stop audio|mute narration|ನಿಲ್ಲಿಸಿ|बंद करो|நிறுத்து|ఆపు|നിർത്തുക)/i.test(txt)) {
    return { type: 'stop_speech', label: 'Stop Audio Narration' };
  }

  // Navigation targets
  if (/(live cam|live camera|face scanner|scanner|camera|ಕ್ಯಾಮೆರಾ|कैमरा|கேமரா|కెమెరా|ക്യാമറ)/i.test(txt)) {
    return { type: 'navigate', tab: 'livecam', label: 'Open Live Face Scanner' };
  }
  if (/(contradiction graph|graph|ಗ್ರಾಫ್|ग्राफ़|வரைபடம்|గ్రాఫ్|ഗ്രാഫ്)/i.test(txt)) {
    return { type: 'navigate', tab: 'graph', label: 'Open Contradiction Graph' };
  }
  if (/(voice agent|agent|ಏಜೆಂಟ್|एजेंट|முகவர்|ఏజెంట్|ഏജന്റ്)/i.test(txt)) {
    return { type: 'navigate', tab: 'agent', label: 'Open Voice Agent' };
  }
  if (/(alerts|notifications|ಎಚ್ಚರಿಕೆ|अलर्ट|எச்சரிக்கை|హెచ్చరిక|അലർട്ട്)/i.test(txt)) {
    return { type: 'navigate', tab: 'alerts', label: 'Open Alerts & Notifications' };
  }
  if (/(community|calibration|ಸಮುದಾಯ|समुदाय|சமூகம்|కమ్యూనిటీ|കമ്മ്യൂണിറ്റി)/i.test(txt)) {
    return { type: 'navigate', tab: 'community', label: 'Open Community Loop' };
  }
  if (/(custody|ledger|chain|ಲೆಡ್ಜರ್|लेजर|லெட்ஜர்|లెడ్జర్|ലെഡ്ജർ)/i.test(txt)) {
    return { type: 'navigate', tab: 'ledger', label: 'Open Custody Ledger' };
  }
  if (/(evidence lab|home|workbench|ಸಾಕ್ಷ್ಯ|साक्ष्य|ஆதார|సాక్ష్య|തെളിവ്)/i.test(txt)) {
    return { type: 'navigate', tab: 'lab', label: 'Open Evidence Lab' };
  }

  // Action intents
  if (/(new case|create case|ಹೊಸ ಪ್ರಕರಣ|नया केस|புதிய வழக்கு|కొత్త కేసు|പുതിയ കേസ്)/i.test(txt)) {
    return { type: 'new_case', label: 'Open New Case Dialog' };
  }
  if (/(run analysis|analyze|analyse|scan case|ವಿಶ್ಲೇಷಣೆ|विश्लेषण|பகுப்பாய்வு|విశ్లేషణ|വിശകലനം)/i.test(txt)) {
    return { type: 'run_analysis', label: 'Run Multimodal Analysis' };
  }
  if (/(read findings|read summary|narrate|briefing|ಓದು|पढ़ो|படி|చదువు|വായിക്കുക)/i.test(txt)) {
    return { type: 'read_findings', label: 'Read Forensic Findings' };
  }
  if (/(explain risk|why flagged|risk level|ಅಪಾಯ|जोखिम|ஆபத்து|ప్రమాద|അപകട)/i.test(txt)) {
    return { type: 'explain_risk', label: 'Explain Calibrated Risk Score' };
  }
  if (/(export pdf|latest report|download report|pdf|ವರದಿ|रिपोर्ट|அறிக்கை|నివేదిక|റിപ്പോർട്ട്)/i.test(txt)) {
    return { type: 'latest_report', label: 'Export Latest PDF Report' };
  }

  return { type: 'unknown', transcript: rawTranscript, label: `Unrecognized: "${rawTranscript}"` };
}
