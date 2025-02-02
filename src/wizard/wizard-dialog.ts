import { LitElement, html, PropertyValues, css, TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import "@material/mwc-dialog";
import "@material/mwc-textfield";
import "@material/mwc-radio";
import "@material/mwc-formfield";
import "@material/mwc-button";
import "@material/mwc-circular-progress";
import type { TextField } from "@material/mwc-textfield";
import {
  connect,
  ESPLoader,
  CHIP_FAMILY_ESP32,
  CHIP_FAMILY_ESP8266,
} from "esp-web-flasher";
import { allowsWebSerial, supportsWebSerial } from "../const";
import {
  compileConfiguration,
  CreateConfigParams,
  createConfiguration,
  deleteConfiguration,
  getConfiguration,
} from "../api/configuration";
import { flashConfiguration } from "../flash";
import { boardSelectOptions } from "./boards";
import { subscribeOnlineStatus } from "../online_status";

const OK_ICON = "🎉";
const WARNING_ICON = "👀";

/*
Flow:
https://docs.google.com/drawings/d/1LAYImcreQdcUxtBt10K76FFypMGRTwu1tGBEERfAWkE/edit?usp=sharing

*/

const GENERIC_ESP32 = "esp32dev";
const GENERIC_ESP8266 = "esp01_1m";

@customElement("esphome-wizard-dialog")
export class ESPHomeWizardDialog extends LitElement {
  @state() private _busy = false;

  @state() private _board: "ESP32" | "ESP8266" | "CUSTOM" = "ESP32";

  private _customBoard = "";

  private _data: Partial<CreateConfigParams> = {};

  @state() private _writeProgress = 0;

  @state() private _state:
    | "basic_config"
    | "connect_webserial"
    | "pick_board"
    | "connecting_webserial"
    | "prepare_flash"
    | "flashing"
    | "wait_come_online"
    | "done" = "basic_config";

  @state() private _error?: string;

  @query("mwc-textfield[name=name]") private _inputName!: TextField;
  @query("mwc-textfield[name=ssid]") private _inputSSID!: TextField;
  @query("mwc-textfield[name=password]") private _inputPassword!: TextField;

  protected render() {
    let heading;
    let content;
    let hideActions = false;

    if (this._state === "basic_config") {
      heading = "Create configuration";
      content = this._renderBasicConfig();
    } else if (this._state === "pick_board") {
      heading = "Select your ESP device";
      content = this._renderPickBoard();
    } else if (this._state === "connect_webserial") {
      heading = "Installation";
      content = this._renderConnectSerial();
    } else if (this._state === "connecting_webserial") {
      content = this._renderProgress("Connecting");
      hideActions = true;
    } else if (this._state === "prepare_flash") {
      content = this._renderProgress("Preparing installation");
      hideActions = true;
    } else if (this._state === "flashing") {
      content = this._renderProgress(
        html`
          Installing<br /><br />
          This will take
          ${this._board === "ESP8266" ? "a minute" : "2 minutes"}.<br />
          Keep this page visible to prevent slow down
        `,
        // Show as undeterminate under 3% or else we don't show any pixels
        this._writeProgress > 3 ? this._writeProgress : undefined
      );
      hideActions = true;
    } else if (this._state === "wait_come_online") {
      content = this._renderProgress("Finding device on network");
      hideActions = true;
    } else if (this._state === "done") {
      if (this._error) {
        content = this._renderMessage(WARNING_ICON, this._error, true);
      } else {
        content = this._renderMessage(OK_ICON, `Configuration created!`, true);
      }
    }

    return html`
      <mwc-dialog
        open
        heading=${heading}
        scrimClickAction
        @closed=${this._handleClose}
        .hideActions=${hideActions}
        >${content}</mwc-dialog
      >
    `;
  }

  _renderProgress(label: string | TemplateResult, progress?: number) {
    return html`
      <div class="center">
        <div>
          <mwc-circular-progress
            active
            ?indeterminate=${progress === undefined}
            .progress=${progress !== undefined ? progress / 100 : undefined}
            density="8"
          ></mwc-circular-progress>
          ${progress !== undefined
            ? html`<div class="progress-pct">${progress}%</div>`
            : ""}
        </div>
        ${label}
      </div>
    `;
  }

  _renderMessage(icon: string, label: string, showClose: boolean) {
    return html`
      <div class="center">
        <div class="icon">${icon}</div>
        ${label}
      </div>
      ${showClose &&
      html`
        <mwc-button
          slot="primaryAction"
          dialogAction="ok"
          label="Close"
        ></mwc-button>
      `}
    `;
  }

  private _renderBasicConfig() {
    return html`
      ${supportsWebSerial
        ? ""
        : html`
            <div class="notice">
              Limited functionality because
              ${allowsWebSerial
                ? html`
                    your browser does not support WebSerial.
                    <a
                      href="https://esphome.io/guides/getting_started_hassio.html#webserial"
                      target="_blank"
                      >Learn more</a
                    >
                  `
                : "you're not browsing the dashboard over a secure connection (HTTPS)."}
            </div>
          `}
      ${this._error ? html`<div class="error">${this._error}</div>` : ""}

      <mwc-textfield
        label="Name"
        name="name"
        required
        pattern="^[a-z0-9-]+$"
        helper="Only use lowercase letters (a-z), numbers (0-9) or dash (-)"
        @input=${this._cleanNameInput}
        @blur=${this._cleanNameBlur}
      ></mwc-textfield>

      <div>
        Enter your Wi-Fi information so your device can connect to your wireless
        network.
      </div>

      <mwc-textfield
        label="Wi-Fi SSID"
        name="ssid"
        required
        @blur=${this._cleanSSIDBlur}
      ></mwc-textfield>

      <mwc-textfield
        label="Wi-Fi password"
        name="password"
        type="password"
        helper="Leave blank if no password"
      ></mwc-textfield>

      <mwc-button
        slot="primaryAction"
        label="Next"
        @click=${this._handleBasicConfigSubmit}
      ></mwc-button>

      <mwc-button
        no-attention
        slot="secondaryAction"
        dialogAction="close"
        label="Cancel"
      ></mwc-button>
    `;
  }

  private _renderPickBoard() {
    return html`
      ${this._error ? html`<div class="error">${this._error}</div>` : ""}

      <div>
        Select the device type that this configuration will be installed on.
      </div>
      <mwc-formfield label="ESP32" checked>
        <mwc-radio
          name="board"
          value="ESP32"
          @click=${this._handlePickBoardRadio}
          ?checked=${this._board === "ESP32"}
        ></mwc-radio>
      </mwc-formfield>

      <mwc-formfield label="ESP8266">
        <mwc-radio
          name="board"
          value="ESP8266"
          @click=${this._handlePickBoardRadio}
          ?checked=${this._board === "ESP8266"}
        ></mwc-radio>
      </mwc-formfield>

      <mwc-formfield label="Pick specific board">
        <mwc-radio
          name="board"
          value="CUSTOM"
          @click=${this._handlePickBoardRadio}
          ?checked=${this._board === "CUSTOM"}
        ></mwc-radio>
      </mwc-formfield>
      ${this._board !== "CUSTOM"
        ? ""
        : html`
            <div class="formfield-extra">
              <select @change=${this._handlePickBoardCustom}>
                ${boardSelectOptions}
              </select>
            </div>
          `}
      <div>
        Pick a custom board if the default targets don't work or if you want to
        use the pin numbers printed on the device in your configuration.
      </div>

      <mwc-button
        slot="primaryAction"
        label="Next"
        @click=${this._handlePickBoardSubmit}
      ></mwc-button>
      <mwc-button
        no-attention
        slot="secondaryAction"
        dialogAction="close"
        label="Cancel"
      ></mwc-button>
    `;
  }

  private _renderConnectSerial() {
    return html`
      ${this._error ? html`<div class="error">${this._error}</div>` : ""}

      <div>
        ESPHome will now create your configuration and install it on your
        device.
      </div>

      <div>
        Connect your ESP32 or ESP8266 board with a USB cable to your computer
        and click on connect. You need to do this once. Later updates install
        wirelessly.
        <a
          href="https://esphome.io/guides/getting_started_hassio.html#webserial"
          target="_blank"
          >Learn more</a
        >
      </div>

      <div>Skip this step to install it on your device later.</div>

      <mwc-button
        slot="primaryAction"
        label="Connect"
        .disabled=${this._busy}
        @click=${this._handleConnectSerialSubmit}
      ></mwc-button>
      <mwc-button
        no-attention
        slot="secondaryAction"
        label="Skip this step"
        .disabled=${this._busy}
        @click=${this._handleConnectSerialSkip}
      ></mwc-button>
    `;
  }

  protected firstUpdated(changedProps: PropertyValues) {
    super.firstUpdated(changedProps);
  }

  protected updated(changedProps: PropertyValues) {
    super.updated(changedProps);
    if (changedProps.has("_state")) {
      const formEl: any = this.shadowRoot!.querySelector(
        "mwc-textfield, mwc-radio, mwc-button"
      );
      if (formEl) {
        formEl.updateComplete.then(() => formEl.focus());
      }
    }

    if (changedProps.has("_board") && this._board === "CUSTOM") {
      this._customBoard = this.shadowRoot!.querySelector("select")!.value;
    }
  }

  private _cleanNameInput = (ev: InputEvent) => {
    this._error = undefined;
    const input = ev.target as TextField;
    input.value = input.value
      // Convert uppercase to lower
      .toLowerCase()
      // Replace seperator characters with -
      .replace(/[ \._]/g, "-")
      // Remove the rest
      .replace(/[^a-z0-9-]/g, "");
  };

  private _cleanNameBlur = (ev: Event) => {
    const input = ev.target as TextField;
    // Remove starting and trailing -
    input.value = input.value.replace(/^-+/, "").replace(/-+$/, "");
  };

  private _cleanSSIDBlur = (ev: Event) => {
    const input = ev.target as TextField;
    // Remove starting and trailing whitespace
    input.value = input.value.trim();
  };

  private async _handleBasicConfigSubmit() {
    const nameInput = this._inputName;
    const ssidInput = this._inputSSID;

    const nameValid = nameInput.reportValidity();
    const ssidValid = ssidInput.reportValidity();

    if (!nameValid || !ssidValid) {
      if (!nameValid) {
        nameInput.focus();
      } else {
        ssidInput.focus();
      }
      return;
    }

    const name = nameInput.value;

    try {
      await getConfiguration(`${name}.yaml`);
      this._error = "Name already in use";
      return;
    } catch (err) {
      // This is expected.
    }

    this._data.name = name;
    this._data.ssid = ssidInput.value;
    this._data.psk = this._inputPassword.value;

    // Use set timeout to avoid dialog keydown handler pressing next button too
    setTimeout(() => {
      this._state =
        supportsWebSerial && allowsWebSerial
          ? "connect_webserial"
          : "pick_board";
    }, 0);
  }

  private _handlePickBoardRadio(ev: MouseEvent) {
    this._board = (ev.target as any).value;
  }

  private _handlePickBoardCustom(ev: Event) {
    this._customBoard = (ev.target as HTMLSelectElement).value;
  }

  private async _handlePickBoardSubmit() {
    if (this._board === "ESP32") {
      this._data.platform = "ESP32";
      this._data.board = GENERIC_ESP32;
    } else if (this._board === "ESP8266") {
      this._data.platform = "ESP8266";
      this._data.board = GENERIC_ESP8266;
    } else {
      this._data.board = this._customBoard;
    }

    this._busy = true;

    try {
      await createConfiguration(this._data as CreateConfigParams);
      this._state = "done";
    } catch (err) {
      this._error = err.message || err;
    } finally {
      this._busy = false;
    }
  }

  private _handleConnectSerialSkip() {
    this._error = undefined;
    this._state = "pick_board";
  }

  private async _handleConnectSerialSubmit() {
    this._busy = true;
    this._error = undefined;
    let esploader: ESPLoader | undefined;
    let removeConfig = false;
    try {
      try {
        esploader = await connect(console);
      } catch (err) {
        console.error(err);
        // User pressed enter.
        this._error = "Press skip step if you don't want to install it now.";
        return;
      }

      this._state = "connecting_webserial";

      try {
        await esploader.initialize();
      } catch (err) {
        console.error(err);
        this._state = "connect_webserial";
        if (esploader.connected) {
          this._error =
            "Failed to initialize. Try resetting your device or holding the BOOT button while selecting your serial port until it starts preparing the installation.";
        }
        return;
      }

      this._state = "prepare_flash";

      if (esploader.chipFamily === CHIP_FAMILY_ESP32) {
        this._board = "ESP32";
        this._data.board = GENERIC_ESP32;
      } else if (esploader.chipFamily === CHIP_FAMILY_ESP8266) {
        this._board = "ESP8266";
        this._data.board = GENERIC_ESP8266;
      } else {
        this._state = "connect_webserial";
        this._error = `Unable to identify the connected device (${esploader.chipFamily}).`;
        return;
      }

      try {
        await createConfiguration(this._data as CreateConfigParams);
      } catch (err) {
        console.error(err);
        this._state = "connect_webserial";
        this._error = "Unable to create the configuration";
        return;
      }

      // Any error after this point goes back to connect serial screen
      // which allows the user to connect a different device.
      // So delete teh configuration as the detected board can be different.
      removeConfig = true;

      try {
        await compileConfiguration(this._configFilename);
      } catch (err) {
        console.error(err);
        this._state = "connect_webserial";
        this._error = "Unable to compile the configuration";
        return;
      }

      this._state = "flashing";

      try {
        await flashConfiguration(
          esploader,
          this._configFilename,
          true,
          (pct) => {
            this._writeProgress = pct;
          }
        );
      } catch (err) {
        console.error(err);
        this._state = "connect_webserial";
        this._error = "Error installing the configuration";
        return;
      }

      // Configuration installed, don't delete it anymore.
      removeConfig = false;

      // Reset the device so it can load new firmware and come online
      await esploader.hardReset();
      await esploader.disconnect();

      this._state = "wait_come_online";

      try {
        await new Promise((resolve, reject) => {
          const unsub = subscribeOnlineStatus((status) => {
            console.log(
              this._configFilename,
              status[this._configFilename],
              status
            );
            if (status[this._configFilename]) {
              unsub();
              clearTimeout(timeout);
              resolve(undefined);
            }
          });
          // Wait up to 20 seconds to let it come online
          const timeout = setTimeout(() => {
            unsub();
            reject("Timeout");
          }, 20000);
        });
      } catch (err) {
        console.error(err);
        this._error = `Configuration created but unable to detect the device on the network`;
      }

      this._state = "done";
    } finally {
      this._busy = false;
      if (esploader?.connected) {
        await esploader.disconnect();
      }
      if (removeConfig) {
        await deleteConfiguration(this._configFilename);
      }
    }
  }

  private get _configFilename(): string {
    return `${this._data.name!}.yaml`;
  }

  private async _handleClose() {
    this.parentNode!.removeChild(this);
    if (this._state === "done" || this._state === "wait_come_online") {
      location.reload();
    }
  }

  static styles = css`
    :host {
      --mdc-dialog-max-width: 390px;
      --mdc-theme-primary: #03a9f4;
    }
    a {
      color: var(--mdc-theme-primary);
    }
    mwc-textfield,
    mwc-formfield {
      display: block;
    }
    .formfield-extra {
      margin-left: 52px;
      margin-bottom: 16px;
    }
    mwc-textfield,
    mwc-textfield + div {
      margin-top: 16px;
    }
    .center {
      text-align: center;
    }
    mwc-circular-progress {
      margin-bottom: 16px;
    }
    .progress-pct {
      position: absolute;
      top: 50px;
      left: 0;
      right: 0;
    }
    .icon {
      font-size: 50px;
      line-height: 80px;
      color: black;
    }
    .notice {
      padding: 8px 24px;
      background-color: #fff59d;
      margin: 0 -24px;
    }
    .error {
      color: #db4437;
      margin-bottom: 16px;
    }
    div + div {
      margin-top: 16px;
    }
    button.link {
      background: none;
      color: var(--mdc-theme-primary);
      border: none;
      padding: 0;
      font: inherit;
      text-align: left;
      text-decoration: underline;
      cursor: pointer;
    }
    mwc-button[no-attention] {
      --mdc-theme-primary: #444;
      --mdc-theme-on-primary: white;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-wizard-dialog": ESPHomeWizardDialog;
  }
}
