import { Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AuthenticatedRequest } from '../../shared/middleware/auth.middleware';
import { ResponseHelper } from '../../shared/utils/response.helper';
import { eventService } from './event.service';
import { CreateEventDTO, UpdateEventDTO, RsvpDTO, EventVisibility, NearbyEventSort } from './event.types';

export class EventController {
    createEvent = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const event = await eventService.createEvent(req.params.id, req.body as CreateEventDTO, req.user!);
            ResponseHelper.success(res, event, 'Event created successfully.', StatusCodes.CREATED);
        } catch (error) {
            next(error);
        }
    };

    listEvents = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
            const visibility = req.query.visibility as EventVisibility | undefined;
            const result = await eventService.listEvents(req.params.id, page, limit, req.user!, visibility);
            ResponseHelper.success(res, result.data, 'Events retrieved successfully.', StatusCodes.OK, result.pagination);
        } catch (error) {
            next(error);
        }
    };

    listNearbyEvents = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = await eventService.listNearbyEvents(
                {
                    lat: parseFloat(req.query.lat as string),
                    lng: parseFloat(req.query.lng as string),
                    radius_km: req.query.radius_km ? parseFloat(req.query.radius_km as string) : undefined,
                    category: req.query.category as string | undefined,
                    sort: req.query.sort as NearbyEventSort | undefined,
                    page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
                    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
                },
                req.user!.userId,
            );
            ResponseHelper.success(res, result.data, 'Nearby events retrieved successfully.', StatusCodes.OK, result.pagination);
        } catch (error) {
            next(error);
        }
    };

    getEvent = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const event = await eventService.getEvent(req.params.id, req.user!);
            ResponseHelper.success(res, event, 'Event retrieved successfully.');
        } catch (error) {
            next(error);
        }
    };

    updateEvent = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const event = await eventService.updateEvent(req.params.id, req.body as UpdateEventDTO, req.user!);
            ResponseHelper.success(res, event, 'Event updated successfully.');
        } catch (error) {
            next(error);
        }
    };

    deleteEvent = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            await eventService.deleteEvent(req.params.id, req.user!);
            ResponseHelper.success(res, null, 'Event cancelled.');
        } catch (error) {
            next(error);
        }
    };

    rsvp = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const rsvp = await eventService.rsvp(req.params.id, req.body as RsvpDTO, req.user!);
            ResponseHelper.success(res, rsvp, 'RSVP submitted successfully.', StatusCodes.CREATED);
        } catch (error) {
            next(error);
        }
    };

    updateRsvp = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const rsvp = await eventService.updateRsvp(req.params.id, req.body as RsvpDTO, req.user!);
            ResponseHelper.success(res, rsvp, 'RSVP updated successfully.');
        } catch (error) {
            next(error);
        }
    };

    cancelRsvp = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            await eventService.cancelRsvp(req.params.id, req.user!);
            ResponseHelper.success(res, null, 'RSVP cancelled.');
        } catch (error) {
            next(error);
        }
    };

    listRsvps = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
            const result = await eventService.listRsvps(req.params.id, page, limit, req.user!);
            ResponseHelper.success(res, result.data, 'RSVPs retrieved successfully.', StatusCodes.OK, result.pagination);
        } catch (error) {
            next(error);
        }
    };
}

export const eventController = new EventController();
