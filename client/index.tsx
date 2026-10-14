//# UI
function buildSettingsStatus(remaining_views: number, expires_after: number, bView = false) {
	if (remaining_views < 0 && expires_after < 0)
		return tr(i18n.Note_will_not_expire);
	else if (remaining_views === 0)
		return tr(i18n.Last_possible_view);
	else
		return tr(i18n.Note_will_expire)(remaining_views, expires_after, bView);
}


function render_refresh_svg() {
	let svg = document.createElement("div");
	svg.innerHTML = `<svg width="24" height="24"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg>`;
	return svg.firstElementChild;
}

function render_copy_svg() {
	let svg = document.createElement("div");
	svg.innerHTML = `<svg width="24" height="24"><path d="M18.984 21V6.984H8.016V21h10.968zm0-15.984q.797 0 1.407.586T21 6.984V21q0 .797-.61 1.406t-1.406.61H8.016q-.797 0-1.407-.61T6 21V6.984q0-.796.61-1.382t1.406-.586h10.968zm-3-4.032V3h-12v14.016H2.016V3q0-.797.586-1.406t1.382-.61h12z"></path></svg>`;
	return svg.firstElementChild;
}

function render_copy(ftext: () => string, extra?: string) {
	const btn: HTMLButtonElement = <button
		className="copy"
		onclick={async () => {
			btn.classList.remove("copied");
			btn.offsetHeight;/* trigger reflow */
			await navigator.clipboard.writeText(ftext());
			btn.classList.add("copied");
		}}
		title={tr(i18n.Copy_to_clipboard)}>{render_copy_svg()}{extra ? " " + extra : ""}</button>;
	return btn;
}

function render_link(note_id: string, keyb64: string) {
	let link_url: HTMLInputElement;
	let link_qrcode: HTMLDivElement;
	let url = new URL(document.location.href);
	url.search = "";
	url.searchParams.append("note", note_id);
	url.hash = keyb64;
	swap_main(
		<div id="link_block">
			<label htmlFor="link_url">{tr(i18n.Share_link)}</label>
			{(link_url = <input id="link_url" type="text" value={url.href} readOnly
				onclick={() => link_url.select()} />)}
			{render_copy(() => url.href)}
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
			// Before fetching, so a malformed link does not consume a view
			checkKeyb64(keyb64);
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
	let read_settings_status: HTMLElement;

	const read_block: HTMLDivElement = <div id="read_block" />;
	const note_block: HTMLFieldSetElement = <fieldset className="box"><legend>{tr(i18n.Note)}</legend></fieldset>;
	if (note.text) {
		note_block.append(
			<fieldset>
				<legend>
					<label htmlFor="read_note">{tr(i18n.Text)}</label>
					{render_copy(() => note.text)}
				</legend>
				<textarea id="read_note" value={note.text} readOnly />
			</fieldset>,
		);
	}
	if (note.files.length > 0) {
		let vec: (HTMLElement | string)[] = [];
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

		note_block.append(
			<fieldset>
				<legend>
					<label>{tr(i18n.Files)}</label>
				</legend>
				<div className="list" id="read_filelist">{...vec}</div>
			</fieldset>,
		);
	}
	if (note.pwd) {
		note_block.append(
			<fieldset>
				<legend>
					<label>{tr(i18n.Credentials)}</label>
					{render_copy(() => note.pwd)}
				</legend>
				<div className="pwd">{...render_pwd_view(note.pwd)}</div>
			</fieldset>,
		);
	}

	read_block.append(note_block, read_settings_status = <p id="read_settings_status" />);

	swap_main(read_block);
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

	/// A logo is served at ./logo
	logo: false,
};

function render_new_note() {
	const pkg = new Pkg();
	pkg.max_total_len = server_config.max_note_size;
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
			input_filelist.style.display = "none";
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
		input_filelist.style.display = "";
	}

	async function create() {
		try {
			input_createbtn.disabled = true;
			input_createbtn.className = "progress";
			input_createbtn.textContent = tr(i18n.Encrypting);
			pkg.text = input_note.value;
			pkg.pwd = input_pwd_checkbox.checked ? input_pwd : "";
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
					input_createbtn.textContent = `${loaded} / ${total}`
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

	let input_note: HTMLTextAreaElement;
	let input_filedrop: HTMLDivElement;
	let input_file: HTMLInputElement;
	let input_filelist: HTMLDivElement;
	let input_remaining_views: HTMLInputElement;
	let input_expires_after: HTMLInputElement;
	let input_createbtn: HTMLButtonElement;
	let input_status: HTMLDivElement;
	let input_settings_status: HTMLDivElement;
	let input_pwd = "";
	let input_pwd_card: HTMLElement;
	let input_pwd_div: HTMLDivElement | null = null;
	let input_pwd_checkbox: HTMLInputElement;
	let input_pwd_switch: HTMLDivElement;
	let input_pwd_generate_btn: HTMLButtonElement;
	let input_pwd_manual_btn: HTMLButtonElement;
	let input_pwd_mode: "generate" | "manual" = "generate";
	function set_pwd(pwd: string) {
		input_pwd = pwd;
		pkg.pwd = pwd;
		renderNoteStatus();
	}
	function render_pwd_panel() {
		input_pwd_div?.remove();
		// Typing starts from the current password, so a generated one can be adjusted
		const div = input_pwd_mode === "generate" ? render_pwd(set_pwd) : render_pwd_input(input_pwd, set_pwd);
		input_pwd_card.append(div);
		input_pwd_div = div;
	}
	function set_pwd_mode(mode: "generate" | "manual") {
		input_pwd_mode = mode;
		input_pwd_generate_btn.classList.toggle("selected", mode === "generate");
		input_pwd_manual_btn.classList.toggle("selected", mode === "manual");
		render_pwd_panel();
	}
	function toggle_pwd() {
		input_pwd_switch.style.display = input_pwd_checkbox.checked ? "" : "none";
		if (input_pwd_checkbox.checked) {
			render_pwd_panel();
		} else {
			input_pwd_div?.remove();
			input_pwd_div = null;
			set_pwd("");
		}
	}
	swap_main(
		<div id="input_block">
			<fieldset className="box">
			<legend>{tr(i18n.Note)}</legend>
			<fieldset>
				<legend>
					<label htmlFor="input_note">{tr(i18n.Text)}</label>
				</legend>
				{
					(input_note = (
						<textarea
							id="input_note"
							placeholder={tr(i18n.write_your_note_here)}
							autocomplete="off"
							oninput={() => {
								pkg.text = input_note.value;
								renderNoteStatus();
							}}
						/>
					))
				}
			</fieldset>
			{server_config.max_files > 0 ? <fieldset id="input_files">
				<legend>
					<label>{tr(i18n.Files)}</label>
				</legend>
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
						<div className="list" id="input_filelist" style="display: none;">
						</div>
					))
				}
			</fieldset> : ""}
			{input_pwd_card = <fieldset>
				<legend>
					{input_pwd_checkbox = <input id="input_pwd_checkbox" type="checkbox" onchange={toggle_pwd} />}
					<label htmlFor="input_pwd_checkbox">
						{tr(i18n.Credentials)}
						<span>{tr(i18n.Credentials_desc)}</span>
					</label>
					{input_pwd_switch = <div className="switch" style="display: none;">
						{input_pwd_generate_btn = <button className="selected" title={tr(i18n.GenerateTooltip)}
							onclick={() => set_pwd_mode("generate")}>{tr(i18n.pwd_mode_generate)}</button>}
						{input_pwd_manual_btn = <button
							onclick={() => set_pwd_mode("manual")}>{tr(i18n.pwd_mode_manual)}</button>}
					</div>}
				</legend>
			</fieldset>}
			</fieldset>

			<fieldset className="box" id="input_settings">
				<legend>{tr(i18n.ShareSettings)}</legend>
				<input type="checkbox"
					checked={server_config.min_remaining_views > 0 || server_config.default_remaining_views > 0}
					disabled={server_config.min_remaining_views > 0} />
				<label htmlFor="input_remaining_views">
					{tr(i18n.Max_views)}
					<span>{tr(i18n.Max_views_desc)}</span>
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
				<input type="checkbox"
					checked={server_config.max_expires_after > 0 || server_config.default_expires_after > 0}
					disabled={server_config.max_expires_after > 0} />
				<label htmlFor="input_expires_after">
					{tr(i18n.Max_duration)}
					<span>{tr(i18n.Max_duration_desc)}</span>
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
			</fieldset>

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



function render_pwd_view(pwd: string): HTMLElement[] {
	const classify = (ch: string) => {
		if (ch === " ") return "pwd-space";
		if (/[a-z]/.test(ch)) return "pwd-lower";
		if (/[A-Z]/.test(ch)) return "pwd-upper";
		if (/[0-9]/.test(ch)) return "pwd-numbers";
		return "pwd-symbols";
	};

	return pwd.split("").map((ch) => (
		<span className={classify(ch)}>
			{ch}
		</span>
	));
}

/// Typed password, rendered like a generated one: the textarea text is transparent, over a colored view.
/// A textarea (not an input) so long passwords wrap identically in both
function render_pwd_input(pwd: string, onchange: (pwd: string) => void) {
	const view: HTMLDivElement = <div className="pwd" />;
	const input: HTMLTextAreaElement = <textarea className="pwd" rows={1} value={pwd}
		autocomplete="off" spellcheck={false}
		onkeydown={(e) => {
			if (e.key === "Enter") e.preventDefault();
		}}
		oninput={() => {
			// Single line password, eg. pasted with a trailing new line
			if (/[\r\n]/.test(input.value)) {
				const caret = input.selectionStart;
				const before = input.value.length;
				input.value = input.value.replace(/[\r\n]/g, "");
				input.selectionStart = input.selectionEnd = Math.max(0, caret - (before - input.value.length));
			}
			render_view();
			onchange(input.value);
		}} />;
	// Zero width space keeps the line height when empty
	const render_view = () => view.replaceChildren(...render_pwd_view(input.value), "​");
	render_view();
	return <div id="input_pwd_typed_block" className="pwd-row">
		<div className="pwd-typed">{view}{input}</div>
		{render_copy(() => input.value)}
	</div>;
}

function render_pwd(onchange: (pwd: string) => void) {
	const opts = {
		len: 10,
		lower: 1,
		upper: 1,
		numbers: 1,
		symbols: 1,
	};
	const inputs: { input_range: HTMLInputElement, input_view: HTMLInputElement, opt: keyof PwdOpts }[] = [];
	let input_remains: { input_range: HTMLInputElement, input_view: HTMLInputElement };
	let input_len: { input_range: HTMLInputElement, input_view: HTMLInputElement };
	function fix_limits() {
		function len(input_range: HTMLInputElement) {
			return Math.min(+input_range.value, opts.len);
		}

		opts.len = +input_len.input_range.value;
		input_len.input_view.value = opts.len.toString();

		let sum = 0;
		for (const { input_range } of inputs)
			sum += len(input_range);

		let scale = 1.0
		if (sum > opts.len)
			scale = opts.len / sum;

		const remains = Math.max(opts.len - sum, 0);
		for (const { input_range, input_view, opt } of inputs) {
			const v = Math.floor(len(input_range) * scale);
			opts[opt] = v;
			input_view.value = v.toString();
			input_range.max = opts.len.toString();
		}
		input_remains.input_view.value = remains.toString();
		input_remains.input_range.value = remains.toString();
		input_remains.input_range.max = opts.len.toString();

		try {
			const pwd = generatePassword(opts);
			onchange(pwd);
			input_pwd_view.classList.remove("error");
			input_pwd_view.innerHTML = "";
			input_pwd_view.append(...render_pwd_view(pwd));
		} catch (e) {
			if (typeof e === "string") {
				input_pwd_view.textContent = e;
				input_pwd_view.classList.add("error");
			}
			else
				throw e;
		}
	}
	function render_pwd_opt(opt: keyof PwdOpts | "remains") {
		const is_len = opt === "len";
		const is_remains = opt === "remains";
		const id = `input_pwd_${opt}`;

		const label = <label htmlFor={id}>{tr(i18n[`pwd_${opt}`])}</label>
		const input_range = <input id={id}
			value={is_remains ? "" : opts[opt].toString()}
			oninput={() => {
				input_view.value = input_range.value
				fix_limits();
			}}
			min={(is_len ? 6 : 0).toString()} max="50" type="range" disabled={is_remains} />
		const input_view = <input value="0" size={3} readOnly />

		if (is_remains)
			input_remains = { input_range, input_view };
		else if (is_len)
			input_len = { input_range, input_view };
		else if (!is_len)
			inputs.push({ input_range, input_view, opt });
		return [label, input_range, input_view]
	}

	let input_pwd_view: HTMLDivElement;
	let ret = <div id="input_pwd">
		{...render_pwd_opt("len")}
		{...render_pwd_opt("lower")}
		{...render_pwd_opt("upper")}
		{...render_pwd_opt("numbers")}
		{...render_pwd_opt("symbols")}
		{...render_pwd_opt("remains")}
		<div className="pwd-row">
			{input_pwd_view = <div className="pwd" />}
			{render_copy(() => input_pwd_view.textContent)}
		</div>
		<button className="refresh" onclick={fix_limits} title={tr(i18n.RegenerateTooltip)}>{render_refresh_svg()}</button>
	</div>;
	fix_limits();
	return ret;
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
	const config = fetch("./config").then(async (res) => {
		server_config = await res.json();
		if (server_config.logo) render_logo();
	});
	if (!note_id || !keyb64) {
		await config;
		render_new_note();
		return;
	}
	render_consume(note_id, keyb64);
}

function render_logo() {
	document.getElementById("rsecnotes")?.after(<img id="logo" src="logo" alt="" />);
}

function render_theme() {
	function set_theme(theme: string | null) {
		if (theme === "light" || theme === "dark") {
			btn_theme.textContent = theme === "light" ? "🌕" : "🌑";
			btn_theme.title = tr(i18n[theme]);
			localStorage.setItem("theme", theme);
			document.documentElement.setAttribute("data-theme", theme);
		}
		else {
			btn_theme.textContent = "🌗";
			btn_theme.title = tr(i18n["auto"]);
			localStorage.removeItem("theme");
			document.documentElement.removeAttribute("data-theme");
		}
	}
	function next_theme() {
		let theme = localStorage.getItem("theme") || "auto";
		const themes = ["auto", "light", "dark"];
		const next = themes[(themes.indexOf(theme) + 1) % themes.length];
		set_theme(next);
	}

	let btn_theme: HTMLButtonElement = <button id="btn_theme" onclick={next_theme}></button>;
	set_theme(localStorage.getItem("theme"));
	return btn_theme;
}


/// Shown over the page, so opening it never discards a note being written or read
let about_dialog: HTMLDialogElement | null = null;
function show_about() {
	if (!about_dialog) {
		about_dialog = render_about();
		document.body.append(about_dialog);
	}
	about_dialog.showModal();
}

function render_about() {
	const dialog: HTMLDialogElement = <dialog id="about" onclick={(e) => {
		// The content fills the dialog, so a click on the dialog itself is a click on the backdrop
		if (e.target === dialog) dialog.close();
	}}>
		<div>
			<h2>{tr(i18n.About_title)}</h2>
			{tr(i18n.about_desc_jsx)()}
			<h3>{tr(i18n.How_it_works)}</h3>
			<ol>{...tr(i18n.about_steps).map((step) => <li>{step}</li>)}</ol>
			<h3>{tr(i18n.Why_aes_gcm)}</h3>
			<ul>{...tr(i18n.about_crypto).map((item) => <li>{item}</li>)}</ul>
			<button autofocus onclick={() => dialog.close()}>{tr(i18n.Close)}</button>
		</div>
	</dialog>;
	return dialog;
}

function render_git_svg() {
	let svg = document.createElement("div");
	svg.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24"><path d="M23.546 10.93L13.067.452c-.604-.603-1.582-.603-2.188 0L8.708 2.627l2.76 2.76c.645-.215 1.379-.07 1.889.441.516.515.658 1.258.438 1.9l2.658 2.66c.645-.223 1.387-.078 1.9.435.721.72.721 1.884 0 2.604-.719.719-1.881.719-2.6 0-.539-.541-.674-1.337-.404-1.996L12.86 8.955v6.525c.176.086.342.203.488.348.713.721.713 1.883 0 2.6-.719.721-1.889.721-2.609 0-.719-.719-.719-1.879 0-2.598.182-.18.387-.316.605-.406V8.835c-.217-.091-.424-.222-.6-.401-.545-.545-.676-1.342-.396-2.009L7.636 3.7.45 10.881c-.6.605-.6 1.584 0 2.189l10.48 10.477c.604.604 1.582.604 2.186 0l10.43-10.43c.605-.603.605-1.582 0-2.187"></path></svg>`;
	return svg.firstElementChild;
}

function render_info_svg() {
	let svg = document.createElement("div");
	svg.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24"><path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"></path></svg>`;
	return svg.firstElementChild;
}

function render_nav() {
	return <nav>
		<button className="about" title={tr(i18n.About)} onclick={show_about}>{render_info_svg()}</button>
		<a className="git" href="https://github.com/Speedy37/rsecnotes" target="_blank" title={tr(i18n.Show_sources)}>{render_git_svg()}</a>
	</nav>
}

const btn_newnote = <button id="btn_newnote" style="display: none;" onclick={() => {
	let url = new URL(document.location.href);
	url.search = "";
	url.hash = "";
	document.location = url.href;
}}>{tr(i18n.New_note)}</button>;
document.title = tr(i18n.title);
main_container.append(
	<div id="slogan_bar">
		{tr(i18n.slogan_jsx)()}
		{render_nav()}
	</div>,
	(main_jsx = <div>{tr(i18n.Loading)}</div>),
	btn_newnote,
	render_theme(),
);
main();
