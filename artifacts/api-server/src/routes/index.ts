import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import leaguesRouter from "./leagues";
import membersRouter from "./members";
import nflGamesRouter from "./nflGames";
import pickEventsRouter from "./pickEvents";
import eventGamesRouter from "./eventGames";
import submissionsRouter from "./submissions";
import boardRouter from "./board";
import standingsRouter from "./standings";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(leaguesRouter);
router.use(membersRouter);
router.use(nflGamesRouter);
router.use(pickEventsRouter);
router.use(eventGamesRouter);
router.use(submissionsRouter);
router.use(boardRouter);
router.use(standingsRouter);
router.use(dashboardRouter);

export default router;
