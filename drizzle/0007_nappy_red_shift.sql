CREATE TABLE "group_tags" (
	"group_id" uuid NOT NULL,
	"tag" varchar(60) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_tags_pk" UNIQUE("group_id","tag")
);
--> statement-breakpoint
ALTER TABLE "groups" ALTER COLUMN "billing_day" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "group_participants" ADD COLUMN "tag" varchar(60);--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "message_intro" varchar(1000) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "message_outro" varchar(1000) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "message_participant_filter" "message_participant_filter" DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "group_tags" ADD CONSTRAINT "group_tags_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;