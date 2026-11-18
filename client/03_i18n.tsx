const i18n = {
	humanSizes: {
		en: ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"],
		fr: ["o", "Ko", "Mo", "Go", "To", "Po", "Eo", "Zo", "Yo"]
	},
	day: {
		en: "day",
		fr: "jour"
	},
	days: {
		en: "days",
		fr: "jours"
	},
	hour: {
		en: "hour",
		fr: "heure"
	},
	hours: {
		en: "hours",
		fr: "heures"
	},
	minute: {
		en: "minute",
		fr: "minute"
	},
	minutes: {
		en: "minutes",
		fr: "minutes"
	},
	second: {
		en: "second",
		fr: "seconde"
	},
	seconds: {
		en: "seconds",
		fr: "secondes"
	},
	title: {
		en: "rsecnotes - Share encrypted notes and/or files",
		fr: "rsecnotes - Partager des notes et/ou fichiers chiffrés",
	},
	slogan_jsx: {
		en: () => (
			<h2>Share <span title={tr(i18n.slogan_title)}>encrypted</span> notes and/or files.</h2>
		),
		fr: () => (
			<h2>Partager des notes et/ou des fichiers <span title={tr(i18n.slogan_title)}>chiffrés</span></h2>
		),
	},
	slogan_title: {
		en: "Encryption is done by your browser with AES-256-GCM and the encryption key is never sent to the server.",
		fr: "Le chiffrement est effectué directement par votre navigateur avec AES-256-GCM et la clé de chiffrement n'est jamais envoyée au serveur.",
	},
	Loading: {
		en: "Loading...",
		fr: "Chargement...",
	},
	Note: {
		en: "Note",
		fr: "Note",
	},
	Text: {
		en: "Text",
		fr: "Texte",
	},
	Files: {
		en: "Files",
		fr: "Fichiers",
	},
	write_your_note_here: {
		en: "Write your note here...",
		fr: "Écrivez votre note ici...",
	},
	Drop_files_here: {
		en: "Drop files here or click here to add files",
		fr: "Déposez vos fichiers ici ou cliquez ici pour ajouter des fichiers",
	},
	Max_views: {
		en: "Max views",
		fr: "Nombre maximal de vues",
	},
	Max_views_desc: {
		en: "How many times can this note be viewed",
		fr: "Combien de fois cette note pourra être vu",
	},
	Max_duration: {
		en: "Expires in",
		fr: "Expire dans",
	},
	Max_duration_desc: {
		en: "How long before this note expires",
		fr: "Combien de temps avant expiration de cette note",
	},
	Remove: {
		en: "Remove",
		fr: "Retirer",
	},
	Create: {
		en: "Create",
		fr: "Créer",
	},
	Encrypting: {
		en: "Encrypting...",
		fr: "Chiffrement...",
	},
	Uploading: {
		en: "Uploading...",
		fr: "Envoi en cours...",
	},
	Share_link: {
		en: "Share link",
		fr: "Partager le lien",
	},
	Copy_to_clipboard: {
		en: "Copy to clipboard",
		fr: "Copier dans le presse-papiers",
	},
	consume_warning: {
		en: "Click 'Show note' to show and delete the note if the view counter has reached its limit",
		fr: "Cliquez sur 'Afficher la note' pour l'afficher et la supprimer si le compteur de vues a atteint sa limite"
	},
	Show_note: {
		en: "Show note",
		fr: "Afficher la note"
	},
	Download: {
		en: "Download",
		fr: "Télécharger"
	},
	Note_will_not_expire: {
		en: "The note will not expire and will be destroyed when the server restarts or to free up memory.",
		fr: "La note n'expirera pas et sera détruite lorsque le serveur redémarrera ou pour libérer de la mémoire."
	},
	Last_possible_view: {
		en: "This was the last view: the note is now destroyed from the server. Save what you need before leaving this page!",
		fr: "C'était la dernière vue : la note est maintenant supprimée du serveur. Enregistrez ce dont vous avez besoin avant de quitter cette page !"
	},
	Note_will_expire: {
		en: (remaining_views: number, expires_after: number, bView = false) => {
			let text = `The note will expire and be destroyed from the server after `;
			if (remaining_views >= 0)
				text += `${remaining_views} ${bView ? "more " : ""} view${remaining_views > 1 ? "s" : ""}`;
			if (remaining_views >= 0 && expires_after >= 0) text += ` or ${bView ? "in" : "after"} `;
			if (expires_after >= 0) text += `${humanReadableSecs(expires_after)}`;
			if (remaining_views >= 0 && expires_after >= 0) text += `, whichever happens first`;
			text += ".";
			return text;
		},
		fr: (remaining_views: number, expires_after: number, bView = false) => {
			let text = `La note expirera et sera supprimée du serveur `;
			if (remaining_views >= 0)
				text += `après ${remaining_views} vue${remaining_views > 1 ? "s" : ""}${bView ? " supplémentaire" : ""}`;
			if (remaining_views >= 0 && expires_after >= 0) text += ` ou ${bView ? "dans" : " après"} `;
			if (expires_after >= 0) text += `${humanReadableSecs(expires_after)}`;
			if (remaining_views >= 0 && expires_after >= 0) text += `, selon la première éventualité`;
			text += ".";
			return text;
		}
	},
	About: {
		en: "About",
		fr: "À propos",
	},
	About_title: {
		en: "About rsecnotes",
		fr: "À propos de rsecnotes",
	},
	about_desc_jsx: {
		en: () => (
			<p>rsecnotes lets you share notes, files and credentials through a link. They are encrypted in your browser before being sent, so only the people you give the link to can read them. Inspired by <a href="https://github.com/cupcakearmy/cryptgeon" target="_blank">cryptgeon</a>.</p>
		),
		fr: () => (
			<p>rsecnotes permet de partager des notes, fichiers et identifiants par un lien. Ils sont chiffrés dans votre navigateur avant d'être envoyés, seules les personnes à qui vous donnez le lien peuvent donc les lire. Inspiré de <a href="https://github.com/cupcakearmy/cryptgeon" target="_blank">cryptgeon</a>.</p>
		),
	},
	How_it_works: {
		en: "How it works",
		fr: "Fonctionnement",
	},
	about_steps: {
		en: [
			"Your browser generates a random key and encrypts the note, its files and credentials with AES-256-GCM.",
			"The server only receives the encrypted note, without the key, so it cannot read it.",
			"The key is added to the share link after the #, a part of the link that browsers never send to the server.",
			"The server keeps the encrypted note in memory, or on disk encrypted again with a key it only keeps in memory. It destroys the note after its last allowed view or when it expires, and earlier when it restarts or needs space for newer notes.",
			"Anyone with the full link can read the note: share it through a channel you trust.",
		],
		fr: [
			"Votre navigateur génère une clé aléatoire et chiffre la note, ses fichiers et identifiants avec AES-256-GCM.",
			"Le serveur ne reçoit que la note chiffrée, sans la clé, il ne peut donc pas la lire.",
			"La clé est ajoutée au lien de partage après le #, une partie du lien que les navigateurs n'envoient jamais au serveur.",
			"Le serveur garde la note chiffrée en mémoire, ou sur disque chiffrée une seconde fois avec une clé qu'il ne garde qu'en mémoire. Il détruit la note après sa dernière vue autorisée ou à son expiration, et plus tôt s'il redémarre ou a besoin de place pour des notes plus récentes.",
			"Toute personne ayant le lien complet peut lire la note : partagez-le par un canal de confiance.",
		],
	},
	Why_aes_gcm: {
		en: "Why AES-256-GCM?",
		fr: "Pourquoi AES-256-GCM ?",
	},
	about_crypto: {
		en: [
			"AES-256-GCM is the strongest authenticated symmetric encryption currently supported by the browsers' Web Crypto API.",
			"GCM authenticates the note: if the encrypted note is altered, decryption fails instead of showing altered content.",
			"Each note has its own key, and a random 96-bit nonce (IV) stored with it: a value used only once, so that encrypting the same content twice never gives the same result.",
			"Encryption is done by the Web Crypto API built into your browser, not by a JavaScript library: it is maintained by the browser vendors, often hardware accelerated and resistant to timing attacks.",
			"The note is padded before encryption, so the server only knows its approximate size.",
		],
		fr: [
			"AES-256-GCM est le chiffrement symétrique authentifié le plus robuste actuellement pris en charge par l'API Web Crypto des navigateurs.",
			"GCM authentifie la note : si la note chiffrée est modifiée, le déchiffrement échoue au lieu d'afficher un contenu altéré.",
			"Chaque note a sa propre clé, et un nonce (IV) aléatoire de 96 bits stocké avec elle : une valeur utilisée une seule fois, pour que chiffrer deux fois le même contenu ne donne jamais le même résultat.",
			"Le chiffrement est effectué par l'API Web Crypto intégrée à votre navigateur, et non par une bibliothèque JavaScript : elle est maintenue par les éditeurs de navigateurs, souvent accélérée matériellement et résistante aux attaques temporelles.",
			"La taille de la note est arrondie avant chiffrement (padding), le serveur n'en connaît donc que la taille approximative.",
		],
	},
	Close: {
		en: "Close",
		fr: "Fermer",
	},
	Show_sources: {
		en: "Show sources",
		fr: "Voir les sources",
	},
	New_note: {
		en: "New note",
		fr: "Nouvelle note"
	},
	auto: {
		en: "theme auto",
		fr: "theme automatique",
	},
	light: {
		en: "theme light",
		fr: "theme clair",
	},
	dark: {
		en: "theme dark",
		fr: "theme sombre",
	},
	Credentials: {
		en: "Credentials",
		fr: "Identifiants",
	},
	Credentials_desc: {
		en: "Share a password",
		fr: "Partager un mot de passe",
	},
	pwd_mode_generate: {
		en: "Generate",
		fr: "Générer",
	},
	pwd_mode_manual: {
		en: "Manual",
		fr: "Manuel",
	},
	GenerateTooltip: {
		en: "Generate password",
		fr: "Générer un mot de passe",
	},
	RegenerateTooltip: {
		en: "Generate a new password",
		fr: "Générer un nouveau mot de passe",
	},
	QR_code: {
		en: "QR code",
		fr: "QR code",
	},
	QR_code_desc: {
		en: "Share a 2FA secret, a Wi-Fi network or any QR code content",
		fr: "Partager un secret 2FA, un réseau Wi-Fi ou le contenu de n'importe quel QR code",
	},
	qr_mode_totp: {
		en: "TOTP",
		fr: "TOTP",
	},
	qr_mode_wifi: {
		en: "Wi-Fi",
		fr: "Wi-Fi",
	},
	qr_mode_text: {
		en: "Text",
		fr: "Texte",
	},
	qr_secret: {
		en: "Secret",
		fr: "Secret",
	},
	qr_secret_placeholder: {
		en: "Base32 secret, or paste an otpauth:// link",
		fr: "Secret en base32, ou collez un lien otpauth://",
	},
	qr_issuer: {
		en: "Issuer",
		fr: "Émetteur",
	},
	qr_account: {
		en: "Account",
		fr: "Compte",
	},
	qr_algorithm: {
		en: "Algorithm",
		fr: "Algorithme",
	},
	qr_digits: {
		en: "Digits",
		fr: "Chiffres",
	},
	qr_period: {
		en: "Period (seconds)",
		fr: "Période (secondes)",
	},
	qr_code: {
		en: "Current code",
		fr: "Code actuel",
	},
	qr_ssid: {
		en: "Network name",
		fr: "Nom du réseau",
	},
	qr_password: {
		en: "Password",
		fr: "Mot de passe",
	},
	qr_security: {
		en: "Security",
		fr: "Sécurité",
	},
	qr_security_none: {
		en: "None",
		fr: "Aucune",
	},
	qr_hidden: {
		en: "Hidden network",
		fr: "Réseau masqué",
	},
	qr_yes: {
		en: "Yes",
		fr: "Oui",
	},
	qr_text_placeholder: {
		en: "Content of the QR code...",
		fr: "Contenu du QR code...",
	},
	qr_scan: {
		en: "Scan it with your phone, eg. with your authenticator app for a TOTP secret",
		fr: "Scannez-le avec votre téléphone, par exemple avec votre application d'authentification pour un secret TOTP",
	},
	qr_totp_warning: {
		en: "Whoever reads this note can generate the codes of this account forever: prefer a single view. The recipient will be asked to keep the secret and the password on separate devices.",
		fr: "Quiconque lit cette note pourra générer les codes de ce compte indéfiniment : préférez une seule vue. Il sera demandé au destinataire de garder le secret et le mot de passe sur des appareils séparés.",
	},
	qr_totp_scan: {
		en: "Scan it with the authenticator app of one device, and keep the password on another one (eg. in the password manager of your computer): a single stolen device then does not give both.",
		fr: "Scannez-le avec l'application d'authentification d'un appareil, et gardez le mot de passe sur un autre (par exemple dans le gestionnaire de mots de passe de votre ordinateur) : un seul appareil volé ne donne alors pas les deux.",
	},
	qr_err_required: {
		en: "Required",
		fr: "Requis",
	},
	qr_err_secret: {
		en: "Invalid secret: base32 expected (letters A-Z, digits 2-7)",
		fr: "Secret invalide : base32 attendu (lettres A-Z, chiffres 2-7)",
	},
	qr_err_hotp: {
		en: "Only TOTP (time based) codes are supported",
		fr: "Seuls les codes TOTP (basés sur le temps) sont pris en charge",
	},
	qr_err_algorithm: {
		en: "Unsupported algorithm",
		fr: "Algorithme non pris en charge",
	},
	qr_err_digits: {
		en: "Digits must be 6, 7 or 8",
		fr: "Le nombre de chiffres doit être 6, 7 ou 8",
	},
	qr_err_period: {
		en: "Invalid period",
		fr: "Période invalide",
	},
	qr_err_too_long: {
		en: "Too long for a QR code",
		fr: "Trop long pour un QR code",
	},
	ShareSettings: {
		en: "Share settings",
		fr: "Paramètres de partage",
	},
	pwd_len: {
		en: "Password length",
		fr: "Longueur du mot de passe"
	},
	pwd_lower: {
		en: "Lowercase letters",
		fr: "Lettres minuscules"
	},
	pwd_upper: {
		en: "Uppercase letters",
		fr: "Lettres majuscules"
	},
	pwd_numbers: {
		en: "Numbers",
		fr: "Chiffres"
	},
	pwd_symbols: {
		en: "Symbols",
		fr: "Symboles"
	},
	pwd_remains: {
		en: "Random mix",
		fr: "Mélange aléatoire"
	},
	pwd_err_noclass: {
		en: "At least one character class must be enabled",
		fr: "Au moins une catégorie de caractères doit être activée"
	},
	pwd_err_nofit: {
		en: "Required classes doesn't fit",
		fr: "Les catégories de caractères requises ne tiennent pas",
	},
	get_note_404: {
		en: "Note not found (probably expired)",
		fr: "Note non trouvée (probablement expirée)"
	},
	get_note_status: {
		en: (status: number) => `Status code: ${status}`,
		fr: (status: number) => `Code d'état : ${status}`,
	},
	invalid_key: {
		en: "Invalid link, the decryption key is malformed.",
		fr: "Lien invalide, la clé de déchiffrement est malformée.",
	},
	Totp_code: {
		en: "TOTP code",
		fr: "Code TOTP",
	},
	Totp_code_desc: {
		en: "(required for large notes, from your authenticator app)",
		fr: "(requis pour les notes volumineuses, depuis votre application d'authentification)",
	},
	totp_invalid: {
		en: "Invalid or expired TOTP code.",
		fr: "Code TOTP invalide ou expiré.",
	},
	totp_too_many_failures: {
		en: "Too many invalid TOTP codes, retry later.",
		fr: "Trop de codes TOTP invalides, réessayez plus tard.",
	},
	totp_upload_failed: {
		en: "Upload failed: the TOTP code may be invalid or expired, or the connection was lost.",
		fr: "Échec de l'envoi : le code TOTP est peut-être invalide ou expiré, ou la connexion a été perdue.",
	},
	decrypt_failed: {
		en: "Decryption failed: the link is wrong, or the note was altered.",
		fr: "Échec du déchiffrement : le lien est erroné, ou la note a été altérée.",
	},
	get_note_failed: {
		en: "Download failed.",
		fr: "Échec du téléchargement.",
	},
	post_note_failed: {
		en: "Upload failed.",
		fr: "Échec de l'envoi.",
	},
};

let langs: string[] = [];
function set_langs(new_langs: string[]) {
	if (!new_langs.includes("en")) new_langs.push("en");
	langs = new_langs;
}
for (let lang of navigator.languages) {
	let prefix = lang.split("-")[0];
	if (!langs.includes(prefix)) langs.push(prefix);
	if (!langs.includes(lang)) langs.push(lang);
}
set_langs(langs);

type Tr<Item> = Item[keyof Item];
function tr<Item extends (typeof i18n)[keyof typeof i18n]>(k: Item): Item[keyof Item] {
	const item: any = k;
	for (let lang of langs) {
		const s = item[lang];
		if (s !== undefined) return s;
	}
	throw new Error(`no translation to ${langs.join(", ")} for '${k}'`);
}
