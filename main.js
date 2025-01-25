const _ = require('lodash')
const fs = require('fs')

const TASKS = require('./data/tasks.json')
const STAFFS = _.shuffle(require('./data/staffs.json'))
const CONFLICTS = require('./data/conflicts.json')
const UNAVAILABLES = require('./data/unavailables.json')
const { warn } = require('console')

const staffWorkloads = STAFFS.map(({ name }) => ({
  name,
  workload: 0
}))

const assignedTasks = [
  { name: 'mon', tasks: [] },
  { name: 'tue', tasks: [] },
  { name: 'wed', tasks: [] },
  { name: 'thu', tasks: [] },
  { name: 'fri', tasks: [] }
]

const unassignedTasks = []

assignedTasks.forEach((assignedTask) => {
  const freq = assignedTask.name
  const assignedStaffsInConflictCatTask = []

  CONFLICTS.cat.forEach((conflict) => {
    assignedStaffsInConflictCatTask.push({
      cat: conflict,
      staffs: []
    })
  })

  TASKS.filter(({ frequencies }) => frequencies.includes(freq)).forEach(
    ({ name, cat, trainers, trainees, shifts, duration }) => {
      shifts.forEach(function (shift) {
        const matchedStaffs = _.filter(STAFFS, (s) => {
          const foundConflictedStaff = assignedStaffsInConflictCatTask.find(
            (c) => c.cat.includes(cat) && c.staffs.includes(s.name)
          )

          if (foundConflictedStaff) {
            return false
          }

          return (
            s.shift == shift &&
            _.includes(trainers, s.name) &&
            !_.includes(UNAVAILABLES[freq], s.name)
          )
        })

        if (matchedStaffs.length == 0) {
          unassignedTasks.push({ freq, name })
          return
        }

        const staff = _.sortBy(
          matchedStaffs,
          function (s) {
            const found = staffWorkloads.find((w) => w.name == s.name)
            if (found) {
              return found.workload
            }
            return 0
          },
          ['desc']
        )[0]

        const foundConflictedStaff = assignedStaffsInConflictCatTask.find((c) =>
          c.cat.includes(cat)
        )

        if (foundConflictedStaff) {
          foundConflictedStaff.staffs.push(staff.name)
        }

        const found = staffWorkloads.find((w) => w.name == staff.name)
        if (found) {
          found.workload += duration
        }

        console.log(assignedStaffsInConflictCatTask)
        assignedTask.tasks.push({
          name,
          shift,
          freq,
          trainer: staff.name,
          trainees
        })
      })
    }
  )
})

console.log(staffWorkloads)
console.log(unassignedTasks)

const flattenTasks = _.reduce(
  assignedTasks,
  (prev, task) => {
    prev.push(...task.tasks)
    return prev
  },
  []
)

const result = _(flattenTasks)
  .groupBy('shift')
  .mapValues((task) => {
    const groupedTasks = _.groupBy(task, 'trainer')
    const result = _.mapValues(groupedTasks, (task) => {
      return _.groupBy(task, 'freq')
    })
    return result
  })
  .value()

fs.writeFileSync(
  './out/assignedTasks.json',
  JSON.stringify(result, null, 2),
  'utf8'
)
fs.writeFileSync(
  './out/workload.json',
  JSON.stringify(staffWorkloads, null, 2),
  'utf8'
)
fs.writeFileSync(
  './out/unassignedTasks.json',
  JSON.stringify(unassignedTasks, null, 2),
  'utf8'
)
