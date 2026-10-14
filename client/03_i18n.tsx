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
		en: "Expires In (minutes)",
		fr: "Expire dans (minutes)",
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
		en: "This is the last possible view of this note, and it's now destroyed from the server!",
		fr: "Ceci est la dernière vue possible de cette note, et elle est maintenant supprimée du serveur !"
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
