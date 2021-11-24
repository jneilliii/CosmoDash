import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import {
  JobStatus,
  PrinterEvent,
  PrinterNotification,
  PrinterStatus,
  ZOffset
} from '../../model';

@Injectable()
export abstract class SocketService {
  abstract connect(): Promise<void>;

  abstract getPrinterStatusSubscribable(): Observable<PrinterStatus>;

  abstract getJobStatusSubscribable(): Observable<JobStatus>;

  abstract getEventSubscribable(): Observable<PrinterEvent | PrinterNotification>;

  abstract getZOffsetSubscribable(): Observable<ZOffset>;
}
