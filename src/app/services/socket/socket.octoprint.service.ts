import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import _, { clamp } from 'lodash-es';
import { Observable, ReplaySubject, Subject } from 'rxjs';
import { pluck, startWith } from 'rxjs/operators';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';

import { ConfigService } from '../../config/config.service';
import { ConversionService } from '../../conversion.service';
import {
  JobStatus,
  PrinterEvent,
  PrinterNotification,
  PrinterState,
  PrinterStatus,
  SocketAuth,
  ZOffset,
} from '../../model';
import {
  DisplayLayerProgressData,
  OctoprintFilament,
  OctoprintPluginMessage,
  OctoprintSocketCurrent,
  OctoprintSocketEvent,
} from '../../model/octoprint';
import { SystemService } from '../system/system.service';
import { SocketService } from './socket.service';

@Injectable()
export class OctoPrintSocketService implements SocketService {
  private fastInterval = 0;
  private socket: WebSocketSubject<unknown>;

  private printerStatusSubject: Subject<PrinterStatus>;
  private jobStatusSubject: Subject<JobStatus>;
  private eventSubject: Subject<PrinterEvent | PrinterNotification>;
  private zOffsetSubject: Subject<ZOffset>;

  private printerStatus: PrinterStatus;
  private jobStatus: JobStatus;
  private lastState: PrinterEvent;
  private zOffset: ZOffset;

  public constructor(
    private configService: ConfigService,
    private systemService: SystemService,
    private conversionService: ConversionService,
    private http: HttpClient,
  ) {
    this.printerStatusSubject = new ReplaySubject<PrinterStatus>();
    this.jobStatusSubject = new Subject<JobStatus>();
    this.eventSubject = new ReplaySubject<PrinterEvent | PrinterNotification>();
    this.zOffsetSubject = new ReplaySubject<ZOffset>();
  }

  //==== SETUP & AUTH ====//

  public connect(): Promise<void> {
    this.initPrinterStatus();
    this.initJobStatus();
    this.initZOfset();
    this.lastState = PrinterEvent.UNKNOWN;

    return new Promise(resolve => {
      this.tryConnect(resolve);
    });
  }

  private initPrinterStatus(): void {
    this.printerStatus = {
      status: PrinterState.connecting,
      bed: {
        current: 0,
        set: 0,
        unit: '°C',
      },
      tool0: {
        current: 0,
        set: 0,
        unit: '°C',
      },
      fanSpeed: 0,
    } as PrinterStatus;
  }

  private initJobStatus(): void {
    this.jobStatus = {
      file: null,
      fullPath: null,
      progress: 0,
      zHeight: this.configService.isDisplayLayerProgressEnabled() ? { current: 0, total: -1 } : 0,
      filamentAmount: 0,
      timePrinted: null,
      timeLeft: {
        value: '---',
        unit: null,
      },
      estimatedPrintTime: null,
      estimatedEndTime: null,
    } as JobStatus;
  }

  private initZOfset(): void {
    this.http.get(
      this.configService.getApiURL('plugin/z_probe_offset_universal'),
      this.configService.getHTTPHeaders()
    ).subscribe((zOffset: ZOffset) => {
      this.zOffset = {
        printer_cap: {
          eeprom: null,
          z_probe: null,
        },
        z_offset: zOffset.z_offset,
      } as ZOffset;
    });
  }

  private tryConnect(resolve: () => void): void {
    this.systemService.getSessionKey().subscribe(
      socketAuth => {
        this.connectSocket();
        this.setupSocket(resolve);
        this.authenticateSocket(socketAuth);
      },
      () => {
        setTimeout(this.tryConnect.bind(this), this.fastInterval < 6 ? 5000 : 15000, resolve);
        this.fastInterval += 1;
      },
    );
  }

  private connectSocket() {
    const url = `${this.configService.getApiURL('sockjs/websocket', false).replace(/^http/, 'ws')}`;
    if (!this.socket) {
      this.socket = webSocket(url);
    }
  }

  private authenticateSocket(socketAuth: SocketAuth) {
    const payload = {
      auth: `${socketAuth.user}:${socketAuth.session}`,
    };
    this.socket.next(payload);
  }

  private handlePluginMessage(pluginMessage: OctoprintPluginMessage) {
    const plugins = [
      {
        check: (plugin: string) => plugin === 'klipper',
        handler: (data: any) => {
          if (['error'].includes(data.subtype)) {
            this.eventSubject.next({
              action: 'show',
              message: data.subtype,
              text: data.payload,
              choices: [],
            } as PrinterNotification);
          }
        },
      },
      {
        check: (plugin: string) => plugin === 'DisplayLayerProgress-websocket-payload'
          && this.configService.isDisplayLayerProgressEnabled(),
        handler: (data: unknown) => {
          this.extractFanSpeed(data as DisplayLayerProgressData);
          this.extractLayerHeight(data as DisplayLayerProgressData);
        },
      },
      {
        check: (plugin: string) => ['action_command_prompt', 'action_command_notification'].includes(plugin),
        handler: (data: unknown) => this.eventSubject.next(data as PrinterNotification),
      },
      {
        check: (plugin: string) => plugin === 'z_probe_offset_universal',
        handler: (data: any) => this.zOffsetSubject.next({
          z_offset: data.msg
        } as ZOffset)
      }
    ];

    plugins.forEach(plugin =>
      plugin.check(pluginMessage.plugin.plugin) && plugin.handler(pluginMessage.plugin.data)
    );
  }

  private setupSocket(resolve: () => void) {
    this.socket.subscribe(message => {
      if (Object.hasOwnProperty.bind(message)('current')) {
        this.extractPrinterStatus(message as OctoprintSocketCurrent);
        this.extractJobStatus(message as OctoprintSocketCurrent);
      } else if (Object.hasOwnProperty.bind(message)('event')) {
        this.extractPrinterEvent(message as OctoprintSocketEvent);
      } else if (Object.hasOwnProperty.bind(message)('plugin')) {
        this.handlePluginMessage(message as OctoprintPluginMessage);
      } else if (Object.hasOwnProperty.bind(message)('reauth')) {
        this.systemService.getSessionKey().subscribe(socketAuth => this.authenticateSocket(socketAuth));
      } else if (Object.hasOwnProperty.bind(message)('connected')) {
        resolve();
        this.checkPrinterConnection();
      }
    });
  }

  private checkPrinterConnection() {
    this.http
      .get(this.configService.getApiURL('connection'), this.configService.getHTTPHeaders())
      .pipe(pluck('current'), pluck('state'))
      .subscribe((state: string) => {
        if (state === 'Closed' || state === 'Error') {
          this.eventSubject.next(PrinterEvent.CLOSED);
        }
      });
  }

  //==== Printer Status ====//

  public extractPrinterStatus(message: OctoprintSocketCurrent): void {
    if (message.current.temps[0]) {
      this.printerStatus.bed = {
        current: Math.round(message?.current?.temps[0]?.bed?.actual),
        set: Math.round(message?.current?.temps[0]?.bed?.target),
        unit: '°C',
      };
      this.printerStatus.tool0 = {
        current: Math.round(message?.current?.temps[0]?.tool0?.actual),
        set: Math.round(message?.current?.temps[0]?.tool0?.target),
        unit: '°C',
      };
    }
    this.printerStatus.status = PrinterState[message.current.state.text.toLowerCase()];

    if (this.printerStatus.status === PrinterState.printing && this.lastState === PrinterEvent.UNKNOWN) {
      this.extractPrinterEvent({
        event: {
          type: 'PrintStarted',
          payload: null,
        },
      } as OctoprintSocketEvent);
    } else if (this.printerStatus.status === PrinterState.paused && this.lastState === PrinterEvent.UNKNOWN) {
      this.extractPrinterEvent({
        event: {
          type: 'PrintPaused',
          payload: null,
        },
      } as OctoprintSocketEvent);
    }
    this.extractFanSpeedFromLogs(message?.current?.logs);
    
    this.printerStatusSubject.next(this.printerStatus);
  }

  public extractFanSpeed(message: DisplayLayerProgressData): void {
    this.printerStatus.fanSpeed =
      message.fanspeed === 'Off' ? 0 : message.fanspeed === '-' ? 0 : Number(message.fanspeed.replace('%', '').trim());
  }

  public extractFanSpeedFromLogs(logs: string[]): void {
    if (logs) {
      const fanSpeedRegex = /M106 S(\d+)/i;
      const fanSpeedLogs = logs.filter(l => fanSpeedRegex.test(l));
      
      if (fanSpeedLogs && fanSpeedLogs.length > 0) {
        const fanSpeedLog = fanSpeedLogs[0];
        const fanSpeedResult = fanSpeedRegex.exec(fanSpeedLog);
        const fanSpeed = Math.round(parseInt(fanSpeedResult[1], 10) / 255 * 100);
        this.printerStatus.fanSpeed = clamp(fanSpeed, 0, 100);
      }
    }
  }

  //==== Job Status ====//

  public extractJobStatus(message: OctoprintSocketCurrent): void {
    const file = message?.current?.job?.file?.display?.replace('.gcode', '').replace('.ufp', '');
    if (this.jobStatus.file !== file) {
      this.initJobStatus();
    }

    this.jobStatus.file = file;
    this.jobStatus.fullPath = '/' + message?.current?.job?.file?.origin + '/' + message?.current?.job?.file?.path;
    this.jobStatus.progress = Math.round(message?.current?.progress?.completion);
    this.jobStatus.timePrinted = {
      value: this.conversionService.convertSecondsToHours(message.current.progress.printTime),
      unit: $localize`:@@unit-h-1:h`,
    };

    if (message.current.job.filament) {
      this.jobStatus.filamentAmount = this.getTotalFilamentWeight(message.current.job.filament);
    }

    if (message.current.progress.printTimeLeft) {
      this.jobStatus.timeLeft = {
        value: this.conversionService.convertSecondsToHours(message.current.progress.printTimeLeft),
        unit: $localize`:@@unit-h-2:h`,
      };
      this.jobStatus.estimatedEndTime = this.calculateEndTime(message.current.progress.printTimeLeft);
    }

    if (message.current.job.estimatedPrintTime) {
      this.jobStatus.estimatedPrintTime = {
        value: this.conversionService.convertSecondsToHours(message.current.job.estimatedPrintTime),
        unit: $localize`:@@unit-h-3:h`,
      };
    }

    if (!this.configService.isDisplayLayerProgressEnabled() && message.current.currentZ) {
      this.jobStatus.zHeight = message.current.currentZ;
    }

    this.jobStatusSubject.next(this.jobStatus);
  }

  private getTotalFilamentWeight(filament: OctoprintFilament) {
    let filamentLength = 0;
    _.forEach(filament, (tool): void => {
      filamentLength += tool?.length;
    });
    return this.conversionService.convertFilamentLengthToWeight(filamentLength);
  }

  private calculateEndTime(printTimeLeft: number) {
    const date = new Date();
    date.setSeconds(date.getSeconds() + printTimeLeft);
    return `${('0' + date.getHours()).slice(-2)}:${('0' + date.getMinutes()).slice(-2)}`;
  }

  public extractLayerHeight(message: DisplayLayerProgressData): void {
    this.jobStatus.zHeight = {
      current: message.currentLayer === '-' ? 0 : Number(message.currentLayer),
      total: message.totalLayer === '-' ? 0 : Number(message.totalLayer),
    };
  }

  //==== Event ====//

  public extractPrinterEvent(state: OctoprintSocketEvent): void {
    let newState: PrinterEvent;

    switch (state.event.type) {
      case 'PrintStarted':
      case 'PrintResumed':
        newState = PrinterEvent.PRINTING;
        break;
      case 'PrintPaused':
        newState = PrinterEvent.PAUSED;
        break;
      case 'PrintFailed':
      case 'PrintDone':
      case 'PrintCancelled':
        newState = PrinterEvent.IDLE;
        break;
      case 'Connected':
        newState = PrinterEvent.CONNECTED;
        break;
      case 'Disconnected':
        newState = PrinterEvent.CLOSED;
        break;
      case 'Error':
        newState = PrinterEvent.CLOSED;
        break;
      default:
        break;
    }

    if (newState !== undefined) {
      this.lastState = newState;
      this.eventSubject.next(newState);
    }
  }

  //==== Subscribables ====//

  public getPrinterStatusSubscribable(): Observable<PrinterStatus> {
    return this.printerStatusSubject.pipe(startWith(this.printerStatus));
  }

  public getJobStatusSubscribable(): Observable<JobStatus> {
    return this.jobStatusSubject.pipe(startWith(this.jobStatus));
  }

  public getEventSubscribable(): Observable<PrinterEvent | PrinterNotification> {
    return this.eventSubject;
  }

  public getZOffsetSubscribable(): Observable<ZOffset> {
    return this.zOffsetSubject.pipe(startWith(this.zOffset));
  }
}
