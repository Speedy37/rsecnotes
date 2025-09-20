const X_EXPIRES_AFTER = "x-note-expires-after";
const X_REMAINING_VIEWS = "x-note-remaining-views";

async function post_note(
	blob: Blob,
	settings: {
		remaining_views: number;
		expires_after: number;
	},
	onprogress?: (loaded: number, total: number) => void,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("POST", "/notes");

		// Update progress bar
		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable) {
				onprogress && onprogress(event.loaded, event.total);
			}
		};

		xhr.onload = () => {
			if (xhr.status === 200) {
				resolve(xhr.responseText);
			} else {
				reject(tr(i18n.post_note_failed) + " " + tr(i18n.get_note_status)(xhr.status));
			}
		};
		xhr.setRequestHeader(X_EXPIRES_AFTER, settings.expires_after.toFixed());
		xhr.setRequestHeader(X_REMAINING_VIEWS, settings.remaining_views.toFixed());
		xhr.onerror = () => {
			reject(tr(i18n.post_note_failed));
		};

		xhr.send(blob);
	});
}

type EncryptedNote = {
	data: ArrayBuffer;
	remaining_views: number;
	expires_after: number;
};
async function get_note(
	note_id: string,
	onprogress?: (loaded: number, total: number) => void,
): Promise<EncryptedNote> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("GET", `/notes/${note_id}`);
		xhr.responseType = "arraybuffer";

		// Download progress bar
		xhr.onprogress = (event) => {
			if (event.lengthComputable) {
				onprogress && onprogress(event.loaded, event.total);
			}
		};

		xhr.onload = () => {
			if (xhr.status === 200) {
				const res = {
					data: xhr.response as ArrayBuffer,
					expires_after: +(xhr.getResponseHeader(X_EXPIRES_AFTER) || "0"),
					remaining_views: +(xhr.getResponseHeader(X_REMAINING_VIEWS) || "0"),
				};

				resolve(res);
			} else if (xhr.status === 404) {
				reject(tr(i18n.get_note_404));
			} else {
				reject(tr(i18n.get_note_failed) + " " + tr(i18n.get_note_status)(xhr.status));
			}
		};
		xhr.onerror = () => {
			reject(tr(i18n.get_note_failed));
		};

		xhr.send();
	});
}
