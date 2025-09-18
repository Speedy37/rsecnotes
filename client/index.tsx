//# UI
function buildSettingsStatus(remaining_views: number, expires_after: number, bView = false) {
	if (remaining_views < 0 && expires_after < 0)
		return tr(i18n.Note_will_not_expire);
	else if (remaining_views === 0)
		return tr(i18n.Last_possible_view);
	else
		return tr(i18n.Note_will_expire)(remaining_views, expires_after, bView);
}

function render_link(note_id: string, keyb64: string) {
	let link_url: HTMLInputElement;
	let link_qrcode: HTMLDivElement;
	let link_copy: HTMLButtonElement;
	let url = new URL(document.location.href);
	url.search = "";
	url.searchParams.append("note", note_id);
	url.hash = keyb64;
	swap_main(
		<div id="link_block">
			<label htmlFor="link_url">{tr(i18n.Share_link)}</label>
			{(link_url = <input id="link_url" type="text" value={url.href} readOnly
				onclick={() => link_url.select()} />)}
			{(link_copy = <button id="link_copy"
				onclick={async () => {
					await navigator.clipboard.writeText(link_url.value);
					link_copy.textContent = tr(i18n.Copied);
				}}>{tr(i18n.Copy_to_clipboard)}</button>)}
			<label>QR Code</label>
			{(link_qrcode = <div id="link_qrcode"></div>)}
		</div>
	);
	btn_newnote.style.display = "";
	new QRCode(link_qrcode, {
		text: url.href,
		width: 512,
		height: 512,
		colorDark: "#000000",
		colorLight: "#ffffff",
		correctLevel: QRCode.CorrectLevel.H,
	});
}

function render_consume(note_id: string, keyb64: string) {
	const consume = async () => {
		try {
			consume_btn.disabled = true;
			consume_btn.className = "progress";
			let raw_note = await get_note(note_id, (loaded, total) => {
				const percent = (loaded / total) * 100;
				consume_btn.style.setProperty("--progress", percent.toFixed(2) + "%");
			});
			let note = await decrypt(keyb64, raw_note.data);
			render_note(raw_note, note);
		} catch (e) {
			consume_btn.textContent = e instanceof Error ? e.message : `${e}`;
			consume_btn.className = "error";
			btn_newnote.style.display = "";
		}
	}
	let consume_btn: HTMLButtonElement;
	swap_main(
		<div id="consume_block">
			<p>{tr(i18n.consume_warning)}</p>
			{(consume_btn = <button id="consume_btn" onclick={consume}>{tr(i18n.Show_note)}</button>)}
		</div>
	);
}

function render_note(raw_note: EncryptedNote, note: DecryptedNote) {
	let read_note: HTMLTextAreaElement;
	let read_copy: HTMLButtonElement;
	let read_filelist: HTMLDivElement;
	let read_settings_status: HTMLElement;

	let vec: (HTMLElement | string)[] = [];
	if (note.files.length === 0)
		vec.push(tr(i18n.No_files_included));
	else {
		note.files.forEach((f, i) => {
			const download = () => {
				const blob = new Blob([f.data]);
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = f.name;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
			}
			vec.push(
				<div>{`${i + 1}. ${f.name}`}</div>,
				<span>{`(${humanSize(f.data.byteLength)})`}</span>,
				<button onclick={download}>{tr(i18n.Download)}</button>,
			);
		})
	}

	swap_main(
		<div id="read_block">
			<label htmlFor="read_note">{tr(i18n.Text)}</label>
			{read_note = <textarea id="read_note" value={note.text} readOnly />}
			{read_copy = <button id="read_copy"
				onclick={async () => {
					await navigator.clipboard.writeText(read_note.value);
					read_copy.textContent = "Copied!";
				}}>{tr(i18n.Copy_to_clipboard)}</button>}

			<label>{tr(i18n.Files)}</label>
			<div className="list" id="read_filelist">{...vec}</div>

			{read_settings_status = <p id="read_settings_status"></p>}
		</div>
	);
	btn_newnote.style.display = "";


	read_settings_status.textContent = buildSettingsStatus(
		raw_note.remaining_views,
		raw_note.expires_after,
		true,
	);
	if (raw_note.expires_after > 0) {
		const remaining_views = raw_note.remaining_views;
		const expires_at = Date.now() + raw_note.expires_after * 1000;
		const renderExpiresAfter = () => {
			const now = Date.now();
			if (expires_at > now) {
				const expires_after = (expires_at - now) / 1000;
				read_settings_status.textContent = buildSettingsStatus(
					remaining_views,
					expires_after,
					true,
				);
				const delay = (expires_after - Math.floor(expires_after)) * 1000;
				setTimeout(renderExpiresAfter, delay + 100);
			} else {
				read_settings_status.textContent = buildSettingsStatus(0, 0, true);
			}
		};
		renderExpiresAfter();
	}
}

let server_config = {
	/// Maximum final size of a note (after encryption and packaging)
	max_note_size: 0,
	/// Maximum number of files, 0 means no file allowed
	max_files: 0,
	/// Number of seconds before this note is removed, 0 for never
	default_expires_after: 0,
	/// Number of views before this note is removed, 0 for never
	default_remaining_views: 0,

	/// Minimal number of views before this note is removed
	min_remaining_views: 0,
	/// Maximal number of views before this note is removed, 0 for no limits
	max_remaining_views: 0,
	/// Minimal number of seconds before this note is removed
	min_expires_after: 0,
	/// Maximal number of seconds before this note is removed, 0 for no limits
	max_expires_after: 0,
};

function render_new_note() {
	const pkg = new Pkg();
	function addFiles(files: FileList | null | undefined) {
		if (!files) return;
		for (const file of files) {
			if (server_config.max_files <= 0 || pkg.files.length < server_config.max_files)
				pkg.addFile(file);
		}
		renderFiles();
		renderNoteStatus();
	}
	function renderNoteStatus() {
		if (pkg.empty) {
			input_status.textContent = "";
			input_settings_status.textContent = "";
			input_createbtn.disabled = true;
			return;
		}
		const doesnt_fit = server_config.max_note_size > 0 && pkg.total_len > server_config.max_note_size;
		input_createbtn.disabled = doesnt_fit;
		const total_len_h = humanSize(pkg.total_len);
		const max_note_size_h = server_config.max_note_size > 0 ? humanSize(server_config.max_note_size) : "♾️";
		input_status.textContent = `Note size: ${total_len_h} / ${max_note_size_h}.`;
		if (doesnt_fit) input_status.textContent += ` Too big, remove some contents.`;
		input_status.className = doesnt_fit ? "error" : "";
		let remaining_views = +input_remaining_views.value;
		let expires_after = +input_expires_after.value * 60;
		if (!Number.isSafeInteger(remaining_views)) remaining_views = 1;
		if (!Number.isSafeInteger(expires_after)) expires_after = 0;
		if (remaining_views === 0) remaining_views = -1;
		if (expires_after === 0) expires_after = -1;
		input_settings_status.textContent = buildSettingsStatus(remaining_views, expires_after);
		input_settings_status.style.all;
	}

	function renderFiles() {
		if (pkg.files.length === 0) {
			input_filelist.innerText = tr(i18n.No_files_selected);
			return;
		}
		input_filelist.innerHTML = "";
		pkg.files.forEach(({ file: f }, i) => {
			input_filelist.append(
				<div>{`${i + 1}. ${f.name}`}</div>,
				<span>{`(${humanSize(f.size)})`}</span>,
				<button onclick={() => {
					pkg.removeFile(i);
					renderFiles();
					renderNoteStatus();
				}}>{tr(i18n.Remove)}</button>,
			);
		});
	}

	async function create() {
		try {
			input_createbtn.disabled = true;
			input_createbtn.className = "progress";
			input_createbtn.textContent = tr(i18n.Encrypting);
			pkg.text = input_note.value;
			const { key, blob } = await pkg.encrypt();
			const keyb64 = base64urlEncode(key);
			input_createbtn.textContent = tr(i18n.Uploading);

			let note_id = await post_note(
				blob,
				{
					remaining_views: +input_remaining_views.value,
					expires_after: +input_expires_after.value * 60,
				},
				(loaded, total) => {
					const percent = (loaded / total) * 100;
					input_createbtn.style.setProperty("--progress", percent.toFixed(2) + "%");
				},
			);

			render_link(note_id, keyb64);
			input_createbtn.className = "";
		} catch (err) {
			input_createbtn.className = "error";
			input_createbtn.textContent = `Error: ${err instanceof Error ? err.message : err}, Retry?`;
		} finally {
			input_createbtn.disabled = false;
		}
	}

	let input_block: HTMLDivElement;
	let input_note: HTMLTextAreaElement;
	let input_files: HTMLDivElement;
	let input_filedrop: HTMLDivElement;
	let input_file: HTMLInputElement;
	let input_filelist: HTMLDivElement;
	let input_remaining_views: HTMLInputElement;
	let input_expires_after: HTMLInputElement;
	let input_createbtn: HTMLButtonElement;
	let input_status: HTMLDivElement;
	let input_settings_status: HTMLDivElement;

	const opt_max = (max: number) => max > 0 ? max.toString() : "";
	swap_main(
		<div id="input_block">
			<label htmlFor="input_note">{tr(i18n.Text)}</label>
			{
				(input_note = (
					<textarea
						id="input_note"
						placeholder={tr(i18n.write_your_note_here)}
						autocomplete="off"
						oninput={(event) => {
							pkg.text = input_note.value;
							renderNoteStatus();
						}}
					/>
				))
			}
			{server_config.max_files > 0 ? <div id="input_files">
				<label>{tr(i18n.Files)}</label>
				{
					(input_filedrop = (
						<div
							id="input_filedrop"
							className="drop"
							onclick={() => input_file.click()}
							ondragover={(e) => {
								e.preventDefault();
								input_filedrop.className = "drop dragover";
							}}
							ondragleave={() => {
								input_filedrop.className = "drop";
							}}
							ondrop={(e) => {
								e.preventDefault();
								input_filedrop.className = "drop";
								addFiles(e.dataTransfer?.files);
							}}>
							{tr(i18n.Drop_files_here)}
							{
								(input_file = (
									<input
										id="input_file"
										type="file"
										multiple
										onchange={() => {
											addFiles(input_file.files);
											input_file.value = "";
										}}
									/>
								))
							}
						</div>
					))
				}
				{
					(input_filelist = (
						<div className="list" id="input_filelist">
							{tr(i18n.No_files_selected)}
						</div>
					))
				}
			</div> : ""}

			<div id="input_settings">
				<label htmlFor="input_remaining_views">
					{tr(i18n.Max_views)}
					<span>({tr(i18n.Zero_or_empty_for_no_limits)})</span>
				</label>
				{
					(input_remaining_views = (
						<input
							id="input_remaining_views"
							value={server_config.default_remaining_views.toString()}
							min={server_config.min_remaining_views.toString()}
							type="number"
							autocomplete="off"
						/>
					))
				}
				<label htmlFor="input_expires_after">
					{tr(i18n.Max_duration)}
					<span>({tr(i18n.Zero_or_empty_for_no_limits)})</span>
				</label>
				{
					(input_expires_after = (
						<input
							id="input_expires_after"
							value={server_config.default_expires_after.toString()}
							min={server_config.min_expires_after.toString()}
							type="number"
							autocomplete="off"
						/>
					))
				}
			</div>

			{
				(input_createbtn = (
					<button id="input_createbtn" onclick={create} disabled>{tr(i18n.Create)}</button>
				))
			}
			{(input_status = <div id="input_status"></div>)}
			{(input_settings_status = <div id="input_settings_status"></div>)}
		</div>
	);
}

const main_container = document.body;
let main_jsx: HTMLElement | null = null;
function swap_main(jsx: HTMLElement) {
	const old_main_jsx = main_jsx;
	main_jsx = jsx;
	if (old_main_jsx) main_container.replaceChild(main_jsx, old_main_jsx);
	else main_container.append(main_jsx);
}

async function main() {
	const page_url = new URL(document.location.href);
	const note_id = page_url.searchParams.get("note");
	const keyb64 = page_url.hash.substring(1);
	if (!note_id || !keyb64) {
		let res = await fetch("./config");
		server_config = await res.json();
		render_new_note();
		return;
	}
	render_consume(note_id, keyb64);
}

const btn_newnote = <button id="btn_newnote" style="display: none;" onclick={() => {
	let url = new URL(document.location.href);
	url.search = "";
	url.hash = "";
	document.location = url.href;
}}>{tr(i18n.New_note)}</button>;
document.title = tr(i18n.title);
main_container.append(
	tr(i18n.slogan_jsx)(),
	(main_jsx = <div>{tr(i18n.Loading)}</div>),
	btn_newnote,
);
main();
