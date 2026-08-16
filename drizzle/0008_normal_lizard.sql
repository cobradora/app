CREATE TABLE "rate_limit_hits" (
	"key" varchar(200) NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rate_limit_hits_pk" UNIQUE("key","window_start")
);
