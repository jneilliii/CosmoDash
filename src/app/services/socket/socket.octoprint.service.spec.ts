import { OctoPrintSocketService } from "./socket.octoprint.service";
import { TestBed } from "@angular/core/testing";
import { HttpClientTestingModule } from "@angular/common/http/testing";
import { ElectronService } from "ngx-electron";
import { Observable } from 'rxjs';
import { SystemService } from "../system/system.service";
import { ConversionService } from "src/app/conversion.service";
import { ConfigService } from "src/app/config/config.service";
import { take } from "rxjs/operators";
import { OctoprintSocketCurrent } from "src/app/model/octoprint";

describe("SocketOctoprintService", () => {
  let service: OctoPrintSocketService;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        OctoPrintSocketService,
        { provide: ElectronService, useValue: { ipcRenderer: { addListener: () => { }, send: () => { } } } },
        { provide: SystemService, useValue: { getSessionKey: new Observable() } },
        ConversionService,
        {
          provide: ConfigService, useValue:
          {
            isFilamentManagerEnabled: () => false,
            getAutomaticHeatingStartSeconds: () => -1,
            getDefaultHotendTemperature: () => 200,
            isDisplayLayerProgressEnabled: () => false
          }
        }
      ],
      imports: [
        HttpClientTestingModule
      ]
    });
    service = TestBed.inject(OctoPrintSocketService);
  });

  it('should create', () => {
    expect(service).toBeTruthy();
  });

  describe('extractFanSpeedFromLogs extrait correctement les M106', () => {
    beforeEach(() => {
      // @ts-ignore Fonction privée
      service.initPrinterStatus();
      // @ts-ignore Attribut privé
      service.printerStatus.fanSpeed = 66;
    });

    describe('seuls', () => {
      it('M106 S255', async (done) => {
        const logs = ['M106 S255'];

        service.extractFanSpeedFromLogs(logs);

        service.getPrinterStatusSubscribable().pipe(take(1)).subscribe((printerStatus) => {
          expect(printerStatus.fanSpeed).toEqual(100);
          done();
        });
      });

      it('M106 S0', async (done) => {
        const logs = ['M106 S0'];

        service.extractFanSpeedFromLogs(logs);

        service.getPrinterStatusSubscribable().pipe(take(1)).subscribe((printerStatus) => {
          expect(printerStatus.fanSpeed).toEqual(0);
          done();
        });
      });

      it('M106 S20', async (done) => {
        const logs = ['M106 S20'];

        service.extractFanSpeedFromLogs(logs);

        service.getPrinterStatusSubscribable().pipe(take(1)).subscribe((printerStatus) => {
          expect(printerStatus.fanSpeed).toEqual(8);
          done();
        });
      });

      it('m106 s9999', async (done) => {
        const logs = ['m106 s9999'];

        service.extractFanSpeedFromLogs(logs);

        service.getPrinterStatusSubscribable().pipe(take(1)).subscribe((printerStatus) => {
          expect(printerStatus.fanSpeed).toEqual(100);
          done();
        });
      });
    });

    describe('accompagnés', () => {
      it("d'un Send :", async (done) => {
        const logs = ['Send: M106 S25'];

        service.extractFanSpeedFromLogs(logs);

        service.getPrinterStatusSubscribable().pipe(take(1)).subscribe((printerStatus) => {
          expect(printerStatus.fanSpeed).toEqual(10);
          done();
        });
      });

      it("d'un Send N11111:", async (done) => {
        const logs = ['Send: N11111 M106 S25*88'];

        service.extractFanSpeedFromLogs(logs);

        service.getPrinterStatusSubscribable().pipe(take(1)).subscribe((printerStatus) => {
          expect(printerStatus.fanSpeed).toEqual(10);
          done();
        });
      });

      it("d'autres logs", async (done) => {
        const logs = [
          'Send: M600 S33',
          'Send: N11111 M106 S25*88',
          'Send: N11111 M899 S80*44'
        ];

        service.extractFanSpeedFromLogs(logs);

        service.getPrinterStatusSubscribable().pipe(take(1)).subscribe((printerStatus) => {
          expect(printerStatus.fanSpeed).toEqual(10);
          done();
        });
      });
    });

    describe('exceptions ne changent pas la valeur', () => {
      beforeEach(() => {
        // @ts-ignore Attribut privé
        service.printerStatus.fanSpeed = 66;
      });

      it("tableau vide", async (done) => {
        const logs = [];

        service.extractFanSpeedFromLogs(logs);

        service.getPrinterStatusSubscribable().pipe(take(1)).subscribe((printerStatus) => {
          expect(printerStatus.fanSpeed).toEqual(66);
          done();
        });
      });

      it("null", async (done) => {
        const logs = null;

        service.extractFanSpeedFromLogs(logs);

        service.getPrinterStatusSubscribable().pipe(take(1)).subscribe((printerStatus) => {
          expect(printerStatus.fanSpeed).toEqual(66);
          done();
        });
      });

      it("undefined", async (done) => {
        const logs = undefined;

        service.extractFanSpeedFromLogs(logs);

        service.getPrinterStatusSubscribable().pipe(take(1)).subscribe((printerStatus) => {
          expect(printerStatus.fanSpeed).toEqual(66);
          done();
        });
      });
    });
  });

  describe('extractPrinterStatus', () => {
    beforeEach(() => {
      // @ts-ignore Fonction privée
      service.initPrinterStatus();
      // @ts-ignore Attribut privé
      service.printerStatus.fanSpeed = 66;
    });

    it('extrait correctement la fanSpeed des logs', async (done) => {
      const message : OctoprintSocketCurrent = {current: {state: {text: 'operational'}, logs: ['Send: N11111 M106 S25*88'], temps: {}}} as OctoprintSocketCurrent;
      const fanSpeeds = [];
      const expectedFanSpeeds = [66, 10];

      service.getPrinterStatusSubscribable().pipe(take(2)).subscribe({next:(printerStatus) => {
        fanSpeeds.push(printerStatus.fanSpeed);
      },
      complete: () => {
        expect(fanSpeeds).toEqual(expectedFanSpeeds);
        done();
      }});

      service.extractPrinterStatus(message);
    });
  });
});